"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { seedImage, ratioDims } from "@/lib/taxonomy";

interface AdCompositionProps {
  imageSeed: string;
  palette?: string[];
  hook: string;
  callToAction?: string;
  ratio?: string;
  brandName?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Real generated media — rendered as-is (the model bakes copy into the image). */
  mediaUrl?: string | null;
}

const HOOK_SIZE = {
  sm: "text-sm leading-snug",
  md: "text-lg leading-snug",
  lg: "text-2xl leading-tight",
};

const CTA_SIZE = {
  sm: "text-[9px] px-2 py-0.5",
  md: "text-[11px] px-3 py-1",
  lg: "text-xs px-4 py-1.5",
};

const PAD = { sm: "p-3", md: "p-4", lg: "p-6" };

/**
 * Renders a believable ad creative from mock data: photography,
 * a palette-tinted scrim, hook typography and a CTA chip — instead
 * of a flat gray placeholder.
 */
export function AdComposition({
  imageSeed,
  palette = ["#1A1A22", "#101014"],
  hook,
  callToAction,
  ratio = "1:1",
  brandName,
  size = "md",
  className,
  mediaUrl,
}: AdCompositionProps) {
  const [loaded, setLoaded] = useState(false);
  const [c1, c2] = [palette[0] ?? "#1A1A22", palette[1] ?? "#101014"];
  const { w, h } = ratioDims(ratio, 900);

  // A real provider produced this creative — show it untouched.
  if (mediaUrl) {
    return (
      <div className={cn("absolute inset-0 select-none bg-canvas", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mediaUrl} alt={hook} className="absolute inset-0 h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div className={cn("absolute inset-0 select-none", className)}>
      {/* base: palette gradient stands in while (or if) the photo loads */}
      <div
        className="absolute inset-0"
        style={{ background: `linear-gradient(150deg, ${c1} 0%, ${c2} 90%)` }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={seedImage(imageSeed, w, h)}
        alt=""
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
          loaded ? "opacity-90" : "opacity-0"
        )}
      />
      {/* scrim so the type always reads — always dark, regardless of palette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(10, 8, 14, 0.88) 0%, rgba(10, 8, 14, 0.42) 40%, transparent 72%)",
        }}
      />
      {brandName && (
        <div className="absolute left-0 top-0 flex items-center gap-1.5 p-3">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: c1 }} />
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/80">
            {brandName}
          </span>
        </div>
      )}
      <div className={cn("absolute inset-x-0 bottom-0 flex flex-col items-start gap-2", PAD[size])}>
        <p className={cn("font-display font-bold text-white drop-shadow-sm text-balance", HOOK_SIZE[size])}>
          {hook}
        </p>
        {callToAction && (
          <span
            className={cn(
              "rounded-full font-semibold uppercase tracking-wide text-white",
              CTA_SIZE[size]
            )}
            style={{ background: c1 }}
          >
            {callToAction}
          </span>
        )}
      </div>
    </div>
  );
}
