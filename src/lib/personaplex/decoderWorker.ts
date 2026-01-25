let lastWorkerError: Error | null = null;

const createWarmupBosPage = (): Uint8Array => {
  const opusHead = new Uint8Array([
    0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64,
    0x01,
    0x01,
    0x38, 0x01,
    0x80, 0xBB, 0x00, 0x00,
    0x00, 0x00,
    0x00,
  ]);

  const pageHeader = new Uint8Array([
    0x4F, 0x67, 0x67, 0x53,
    0x00,
    0x02,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x01,
    0x13,
  ]);

  const bosPage = new Uint8Array(pageHeader.length + opusHead.length);
  bosPage.set(pageHeader, 0);
  bosPage.set(opusHead, pageHeader.length);
  return bosPage;
};

const createWorkerWithErrorTracking = (): Worker => {
  const decoderScriptUrl = new URL('/assets/decoderWorker.min.js', import.meta.url).toString();
  const decoderWasmUrl = new URL('/assets/decoderWorker.min.wasm', import.meta.url).toString();
  const workerSource = `
    self.Module = {
      locateFile: (path, prefix) => {
        if (path && path.endsWith('.wasm')) return '${decoderWasmUrl}';
        return (prefix || '') + path;
      }
    };
    importScripts('${decoderScriptUrl}');
  `;
  const workerBlob = new Blob([workerSource], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(workerBlob);
  const worker = new Worker(workerUrl);
  worker.onerror = (event) => {
    console.error('Decoder worker error:', event.message);
    lastWorkerError = new Error(event.message);
  };
  return worker;
};

const sendInitCommand = (worker: Worker, audioContextSampleRate: number): void => {
  worker.postMessage({
    command: 'init',
    bufferLength: 960 * audioContextSampleRate / 24000,
    decoderSampleRate: 24000,
    outputBufferSampleRate: audioContextSampleRate,
    resampleQuality: 0,
  });

  setTimeout(() => {
    const bosPage = createWarmupBosPage();
    worker.postMessage({ command: 'decode', pages: bosPage });
  }, 100);
};

export const createDecoderWorker = (): Worker => createWorkerWithErrorTracking();

export const initDecoder = (worker: Worker, audioContextSampleRate: number): Promise<void> => {
  return new Promise((resolve) => {
    lastWorkerError = null;
    sendInitCommand(worker, audioContextSampleRate);
    setTimeout(() => {
      resolve();
    }, 1000);
  });
};

export const getDecoderWorkerError = (): Error | null => lastWorkerError;
