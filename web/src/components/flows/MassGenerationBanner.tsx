"use client";

import Link from "next/link";
import { ArrowRight, Layers } from "lucide-react";

/** A quiet hint above the dashboard prompt: several images at once live in Flows. */
export function MassGenerationBanner() {
  return (
    <Link
      href="/flows"
      className="group mx-auto mb-3 flex w-fit max-w-full items-center gap-2 rounded-full border border-border bg-card/60 px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
    >
      <Layers className="h-3.5 w-3.5 shrink-0 text-iris" />
      <span className="truncate sm:hidden">
        Several images at once? <span className="font-semibold text-foreground">Try Flows</span>
      </span>
      <span className="hidden truncate sm:inline">
        Need several images? <span className="font-semibold text-foreground">Create them all at once with Flows</span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** "3 images", "four variations", "a few ads"… → how many the person wants (0 when they don't say a number above one). */
export function wantsSeveral(text: string): number {
  const m = text.match(/\b(\d{1,2}|two|three|four|five|six|a couple of|a few)\s+(?:different\s+|separate\s+|unique\s+)?(images?|pictures?|photos?|ads?|creatives?|variations?|versions?|videos?)\b/i);
  if (!m) return 0;
  const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, "a couple of": 2, "a few": 3 };
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : words[m[1].toLowerCase()] ?? 0;
  return n >= 2 ? n : 0;
}
