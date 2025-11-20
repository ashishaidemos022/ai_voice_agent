import { useEffect, useRef } from 'react';

interface WaveformLinearProps {
  waveformData: Uint8Array | null;
  isActive: boolean;
  color?: string;
  height?: number;
}

export function WaveformLinear({
  waveformData,
  isActive,
  color = '#3B82F6',
  height = 80,
}: WaveformLinearProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.offsetWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const draw = () => {
      ctx.fillStyle = 'rgba(249, 250, 251, 1)';
      ctx.fillRect(0, 0, width, height);

      if (waveformData && isActive) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.beginPath();

        const sliceWidth = width / waveformData.length;
        let x = 0;

        for (let i = 0; i < waveformData.length; i++) {
          const v = waveformData[i] / 128.0;
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }

          x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#E5E7EB';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [waveformData, isActive, color, height]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg"
      style={{ height: `${height}px` }}
    />
  );
}
