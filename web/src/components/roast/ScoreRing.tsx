"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { scoreTone } from "@/lib/taxonomy";

const TONE_HSL: Record<string, string> = {
  mint: "hsl(var(--mint))",
  honey: "hsl(var(--honey))",
  flame: "hsl(var(--flame))",
};

interface ScoreRingProps {
  score: number; // 0-100
  size?: number; // px
  label?: string;
  className?: string;
}

/** Radial score meter — the roast verdict. Color follows the score. */
export function ScoreRing({ score, size = 120, label, className }: ScoreRingProps) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setProgress(score));
    return () => cancelAnimationFrame(t);
  }, [score]);

  const stroke = Math.max(4, Math.round(size / 16));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = TONE_HSL[scoreTone(score)];

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-secondary" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={tone}
          strokeDasharray={c}
          strokeDashoffset={c - (c * progress) / 100}
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-bold" style={{ fontSize: size / 3.4, color: tone }}>
          {score}
        </span>
        {label && <span className="eyebrow mt-0.5" style={{ fontSize: Math.max(8, size / 14) }}>{label}</span>}
      </div>
    </div>
  );
}
