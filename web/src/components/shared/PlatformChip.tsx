"use client";

import { cn } from "@/lib/utils";
import { platformMeta } from "@/lib/taxonomy";
import type { Platform } from "@/models";

interface PlatformChipProps {
  platform: Platform;
  placementLabel?: string;
  className?: string;
}

/** Small platform badge: brand-colored dot + label, mono placement suffix. */
export function PlatformChip({ platform, placementLabel, className }: PlatformChipProps) {
  const meta = platformMeta(platform);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[11px] font-medium text-secondary-foreground",
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.hue }} />
      {meta.label}
      {placementLabel && (
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          {placementLabel}
        </span>
      )}
    </span>
  );
}
