"use client";

import { cn } from "@/lib/utils";
import { ratioCss } from "@/lib/taxonomy";

interface CreativeFrameProps {
  ratio: string; // "4:5"
  children: React.ReactNode;
  className?: string;
  showRatio?: boolean;
  marks?: boolean;
}

/**
 * The BackdropAds artboard — every creative lives inside a crop-marked
 * viewfinder frame with its aspect ratio stamped in mono, like an
 * artboard on a studio canvas.
 */
export function CreativeFrame({ ratio, children, className, showRatio = true, marks = true }: CreativeFrameProps) {
  return (
    <div className={cn("relative", marks && "artboard", className)}>
      {marks && <span className="artboard-marks" aria-hidden />}
      <div
        className="relative w-full overflow-hidden rounded-md bg-canvas"
        style={{ aspectRatio: ratioCss(ratio) }}
      >
        {children}
      </div>
      {showRatio && (
        <span className="pointer-events-none absolute -bottom-5 right-0 font-mono text-[10px] tracking-[0.15em] text-muted-foreground/70">
          {ratio}
        </span>
      )}
    </div>
  );
}
