export class AudioManager {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private dataArray: Uint8Array | null = null;
  private processor: ScriptProcessorNode | null = null;
  private onAudioDataCallback: ((data: Int16Array) => void) | null = null;
  private isInitializing = false;
  private isInitialized = false;
  private isClosing = false;
  private initializationPromise: Promise<void> | null = null;
  private audioQueue: Array<{ buffer: AudioBuffer; resolve: () => void }> = [];
  private isPlayingAudio = false;

  async initialize(): Promise<void> {
    if (this.isInitializing && this.initializationPromise) {
      console.log('AudioManager initialization already in progress, waiting...');
      return this.initializationPromise;
    }

    if (this.isInitialized) {
      console.warn('AudioManager is already initialized');
      return;
    }

    if (this.isClosing) {
      throw new Error('AudioManager is closing, cannot initialize');
    }

    this.isInitializing = true;
    this.initializationPromise = this.performInitialization();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async performInitialization(): Promise<void> {

    try {
      if (!window.AudioContext && !(window as any).webkitAudioContext) {
        throw new Error('Web Audio API is not supported in this browser');
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser');
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;

      try {
        this.audioContext = new AudioContextClass({ sampleRate: 24000 });
      } catch (sampleRateError) {
        console.warn('Failed to create AudioContext with 24000 Hz, using default sample rate:', sampleRateError);
        this.audioContext = new AudioContextClass();
      }

      if (!this.audioContext) {
        throw new Error('Failed to create AudioContext - constructor returned null');
      }

      if (this.audioContext.state === 'closed') {
        throw new Error('AudioContext was created but is in closed state');
      }

      console.log('AudioContext created successfully with sample rate:', this.audioContext.sampleRate);

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      console.log('Requesting microphone access...');

      try {
        this.stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Microphone access timeout')), 10000)
          )
        ]);
      } catch (streamError: any) {
        console.error('getUserMedia error:', streamError);
        throw streamError;
      }

      if (!this.stream) {
        throw new Error('Failed to get media stream - getUserMedia returned null');
      }

      console.log('Media stream acquired, creating microphone source...');

      if (this.isClosing) {
        throw new Error('AudioManager is closing, aborting initialization');
      }

      if (!this.audioContext) {
        throw new Error('AudioContext is null before creating media stream source');
      }

      this.microphone = this.audioContext.createMediaStreamSource(this.stream);

      if (!this.microphone) {
        throw new Error('Failed to create media stream source');
      }

      this.microphone.connect(this.analyser);

      this.isInitialized = true;
      console.log('AudioManager initialized successfully');
    } catch (error: any) {
      console.error('Failed to initialize audio:', error);

      if (!this.isClosing) {
        this.performCleanup();
      }

      if (error.name === 'NotAllowedError') {
        throw new Error('Microphone permission denied. Please allow microphone access.');
      } else if (error.name === 'NotFoundError') {
        throw new Error('No microphone found. Please connect a microphone.');
      } else if (error.name === 'NotReadableError') {
        throw new Error('Microphone is already in use by another application.');
      } else if (error.name === 'OverconstrainedError') {
        throw new Error('Microphone does not support the required audio constraints.');
      }

      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  isCurrentlyInitializing(): boolean {
    return this.isInitializing;
  }

  async startCapture(onAudioData: (data: Int16Array) => void): Promise<void> {
    if (!this.audioContext || !this.stream) {
      throw new Error('AudioManager not initialized. Call initialize() first.');
    }

    if (!this.microphone) {
      throw new Error('Microphone source not available. Initialization may have failed.');
    }

    this.onAudioDataCallback = onAudioData;

    const bufferSize = 4096;
    this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

    if (!this.processor) {
      throw new Error('Failed to create audio processor');
    }

    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const int16Data = new Int16Array(inputData.length);

      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      if (this.onAudioDataCallback) {
        this.onAudioDataCallback(int16Data);
      }
    };

    this.microphone.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  stopCapture(): void {
    this.onAudioDataCallback = null;

    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
  }

  getWaveformData(): Uint8Array | null {
    if (!this.analyser || !this.dataArray) return null;
    this.analyser.getByteTimeDomainData(this.dataArray);
    return this.dataArray;
  }

  getVolume(): number {
    if (!this.analyser || !this.dataArray) return 0;
    this.analyser.getByteTimeDomainData(this.dataArray);

    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      const normalized = (this.dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / this.dataArray.length);
  }

  async playAudioData(base64Audio: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        if (!this.audioContext || this.audioContext.state === 'closed') {
          console.warn('AudioContext not available for playback');
          resolve();
          return;
        }

        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
          float32Array[i] = int16Array[i] / 32768.0;
        }

        const audioBuffer = this.audioContext.createBuffer(
          1,
          float32Array.length,
          24000
        );
        audioBuffer.getChannelData(0).set(float32Array);

        this.audioQueue.push({ buffer: audioBuffer, resolve });

        if (!this.isPlayingAudio) {
          this.processAudioQueue();
        }
      } catch (error) {
        console.error('Failed to prepare audio:', error);
        resolve();
      }
    });
  }

  private processAudioQueue(): void {
    if (this.audioQueue.length === 0 || !this.audioContext) {
      this.isPlayingAudio = false;
      return;
    }

    this.isPlayingAudio = true;
    const { buffer, resolve } = this.audioQueue.shift()!;

    try {
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);

      source.onended = () => {
        resolve();
        this.processAudioQueue();
      };

      source.start();
    } catch (error) {
      console.error('Failed to play audio chunk:', error);
      resolve();
      this.processAudioQueue();
    }
  }

  private performCleanup(): void {
    if (this.isClosing) {
      console.log('Cleanup already in progress, skipping...');
      return;
    }

    this.isClosing = true;
    console.log('Cleaning up AudioManager...');

    this.audioQueue = [];
    this.isPlayingAudio = false;

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    if (this.microphone) {
      try {
        this.microphone.disconnect();
      } catch (e) {
        console.warn('Error disconnecting microphone:', e);
      }
      this.microphone = null;
    }

    if (this.processor) {
      try {
        this.processor.disconnect();
        this.processor.onaudioprocess = null;
      } catch (e) {
        console.warn('Error disconnecting processor:', e);
      }
      this.processor = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {
        console.warn('Error closing AudioContext:', e);
      }
    }
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
    this.isInitialized = false;
    this.isClosing = false;
    this.initializationPromise = null;
    console.log('AudioManager cleanup complete');
  }

  close(): void {
    if (this.isInitializing) {
      console.warn('Attempted to close AudioManager while initializing');
    }

    this.stopCapture();
    this.performCleanup();
  }
}
