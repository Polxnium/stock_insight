import { useEffect, useRef } from 'react';
import type { SelectorStock } from '@/strategies/quantSelector';

interface FactorRadarProps {
  stock: SelectorStock;
}

interface FactorData {
  name: string;
  score: number;
  color: string;
}

export function FactorRadar({ stock }: FactorRadarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 200;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const maxRadius = 80;

    const factors: FactorData[] = [
      { name: '基本面', score: stock.score.fundamentalScore, color: '#22c55e' },
      { name: '技术面', score: stock.score.technicalScore, color: '#3b82f6' },
      { name: '资金面', score: stock.score.moneyScore, color: '#a855f7' },
      { name: '风险评估', score: 100 - (stock.risk.riskLevel === 'high' ? 30 : stock.risk.riskLevel === 'medium' ? 15 : 0), color: '#f97316' },
    ];

    const numFactors = factors.length;
    const angleStep = (Math.PI * 2) / numFactors;

    ctx.clearRect(0, 0, size, size);

    for (let level = 5; level >= 1; level--) {
      const radius = (maxRadius / 5) * level;
      ctx.beginPath();
      for (let i = 0; i < numFactors; i++) {
        const angle = i * angleStep - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = level % 2 === 0 ? '#f9fafb' : '#ffffff';
      ctx.fill();
    }

    for (let i = 0; i < numFactors; i++) {
      const angle = i * angleStep - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
        centerX + maxRadius * Math.cos(angle),
        centerY + maxRadius * Math.sin(angle)
      );
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.beginPath();
    factors.forEach((factor, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const radius = (factor.score / 100) * maxRadius;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
    ctx.fill();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.stroke();

    factors.forEach((factor, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const radius = (factor.score / 100) * maxRadius;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = factor.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    factors.forEach((factor, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const labelRadius = maxRadius + 20;
      const x = centerX + labelRadius * Math.cos(angle);
      const y = centerY + labelRadius * Math.sin(angle);

      ctx.fillStyle = '#374151';
      ctx.fillText(factor.name, x, y);
    });

  }, [stock]);

  return (
    <div className="flex flex-col items-center">
      <canvas ref={canvasRef} className="rounded-lg" />
      <div className="mt-3 grid grid-cols-2 gap-4 text-xs">
        {[
          { name: '基本面', score: stock.score.fundamentalScore, color: '#22c55e' },
          { name: '技术面', score: stock.score.technicalScore, color: '#3b82f6' },
          { name: '资金面', score: stock.score.moneyScore, color: '#a855f7' },
          { name: '风险评估', score: 100 - (stock.risk.riskLevel === 'high' ? 30 : stock.risk.riskLevel === 'medium' ? 15 : 0), color: '#f97316' },
        ].map((item) => (
          <div key={item.name} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-ink-600">{item.name}</span>
            <span className="font-medium" style={{ color: item.color }}>
              {item.score.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}