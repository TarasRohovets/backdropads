"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdComposition } from "./AdComposition";
import type { CarouselSlide } from "@/models";

interface CarouselCompositionProps {
  slides: CarouselSlide[];
  palette?: string[];
  callToAction?: string;
  ratio?: string;
  size?: "sm" | "md" | "lg";
  brandName?: string;
  /** controlled slide index (optional) */
  index?: number;
  onIndexChange?: (i: number) => void;
}

/** Carousel creative preview with slide navigation and position dots. */
export function CarouselComposition({
  slides,
  palette,
  callToAction,
  ratio = "4:5",
  size = "md",
  brandName,
  index,
  onIndexChange,
}: CarouselCompositionProps) {
  const [internal, setInternal] = useState(0);
  const i = index ?? internal;
  const setI = (next: number) => {
    const clamped = (next + slides.length) % slides.length;
    onIndexChange ? onIndexChange(clamped) : setInternal(clamped);
  };
  const slide = slides[i];
  if (!slide) return null;

  return (
    <>
      <AdComposition
        imageSeed={slide.imageSeed}
        palette={palette}
        hook={slide.headline}
        callToAction={i === slides.length - 1 ? callToAction : undefined}
        ratio={ratio}
        size={size}
        brandName={brandName}
      />
      {/* slide counter */}
      <span className="absolute right-2.5 top-2.5 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white/90 backdrop-blur-sm">
        {i + 1}/{slides.length}
      </span>
      {/* nav arrows */}
      <button
        type="button"
        aria-label="Previous slide"
        onClick={(e) => { e.stopPropagation(); setI(i - 1); }}
        className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-1 text-white/90 backdrop-blur-sm transition hover:bg-black/70"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Next slide"
        onClick={(e) => { e.stopPropagation(); setI(i + 1); }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-1 text-white/90 backdrop-blur-sm transition hover:bg-black/70"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {/* dots */}
      <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1">
        {slides.map((s, di) => (
          <button
            key={s.id}
            type="button"
            aria-label={`Slide ${di + 1}`}
            onClick={(e) => { e.stopPropagation(); setI(di); }}
            className={cn(
              "h-1 rounded-full transition-all",
              di === i ? "w-4 bg-white" : "w-1 bg-white/45"
            )}
          />
        ))}
      </div>
    </>
  );
}
