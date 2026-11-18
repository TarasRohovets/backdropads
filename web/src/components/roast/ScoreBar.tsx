"use client";

import { useEffect, useState } from "react";
import { scoreTone } from "@/lib/taxonomy";

const TONE_HSL: Record<string, string> = {
  mint: "hsl(var(--mint))",
  honey: "hsl(var(--honey))",
  flame: "hsl(var(--flame))",
};

interface ScoreBarProps {
  label: string;
  score: number;
  delay?: number; // ms stagger
}

/** One scored dimension (Hook, Visual, Offer…) as a labeled meter. */
export function ScoreBar({ label, score, delay = 0 }: ScoreBarProps) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(score), 80 + delay);
    return () => clearTimeout(t);
  }, [score, delay]);
  const tone = TONE_HSL[scoreTone(score)];

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="font-mono text-xs" style={{ color: tone }}>{score}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full"
          style={{
            width: `${w}%`,
            background: tone,
            transition: "width 0.9s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </div>
    </div>
  );
}
