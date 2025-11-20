import { useEffect, useRef } from 'react';

interface AnimatedWaveProps {
  waveformData: Uint8Array | null;
  isActive: boolean;
  isProcessing: boolean;
  isConnected: boolean;
}

interface WaveLayer {
  frequency: number;
  amplitude: number;
  phase: number;
  speed: number;
  opacity: number;
  color: string;
}

export function AnimatedWave({
  waveformData,
  isActive,
  isProcessing,
  isConnected,
}: AnimatedWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const phaseRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const centerY = height / 2;

    const calculateAmplitude = (): number => {
      if (!isConnected) return 0;
      if (isProcessing) return 8;
      if (!isActive) return 15;

      if (waveformData && waveformData.length > 0) {
        const sum = waveformData.reduce((acc, val) => acc + val, 0);
        const average = sum / waveformData.length;
        const normalized = (average - 128) / 128;
        return 15 + Math.abs(normalized) * 45;
      }

      return 15;
    };

    const layers: WaveLayer[] = [
      {
        frequency: 0.015,
        amplitude: calculateAmplitude() * 1.0,
        phase: 0,
        speed: 0.02,
        opacity: 1.0,
        color: '#3bb6ff'
      },
      {
        frequency: 0.025,
        amplitude: calculateAmplitude() * 0.7,
        phase: Math.PI / 3,
        speed: 0.015,
        opacity: 0.7,
        color: '#60c5ff'
      },
      {
        frequency: 0.035,
        amplitude: calculateAmplitude() * 0.5,
        phase: Math.PI / 1.5,
        speed: 0.01,
        opacity: 0.4,
        color: '#75fdfd'
      }
    ];

    const drawWave = (layer: WaveLayer, glow: boolean = false) => {
      ctx.beginPath();

      for (let x = 0; x <= width; x += 2) {
        const y = centerY + Math.sin(x * layer.frequency + layer.phase + phaseRef.current) * layer.amplitude;

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      if (glow) {
        ctx.strokeStyle = layer.color;
        ctx.lineWidth = 6;
        ctx.globalAlpha = layer.opacity * 0.3;
        ctx.filter = 'blur(12px)';
        ctx.stroke();
        ctx.filter = 'none';
      } else {
        ctx.strokeStyle = layer.color;
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = layer.opacity;
        ctx.stroke();
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      const currentAmplitude = calculateAmplitude();

      layers.forEach(layer => {
        const targetAmplitude = layer === layers[0]
          ? currentAmplitude * 1.0
          : layer === layers[1]
          ? currentAmplitude * 0.7
          : currentAmplitude * 0.5;

        layer.amplitude += (targetAmplitude - layer.amplitude) * 0.1;

        drawWave(layer, true);
        drawWave(layer, false);

        layer.phase += layer.speed;
      });

      phaseRef.current += isProcessing ? 0.005 : isActive ? 0.03 : 0.01;

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [waveformData, isActive, isProcessing, isConnected]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ mixBlendMode: 'screen' }}
    />
  );
}
