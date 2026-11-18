"use client";

import { Play } from "lucide-react";
import { AdComposition } from "./AdComposition";
import type { ConceptVideo } from "@/models";

interface VideoCompositionProps {
  imageSeed: string;
  palette?: string[];
  hook: string;
  callToAction?: string;
  ratio?: string;
  video?: ConceptVideo | null;
  size?: "sm" | "md" | "lg";
  brandName?: string;
  /** Real generated video — rendered as a playable element. */
  mediaUrl?: string | null;
}

const fmtDuration = (s: number) => `0:${String(s).padStart(2, "0")}`;

/** Video creative preview: composition + play affordance + duration + caption line. */
export function VideoComposition({ video, mediaUrl, ...comp }: VideoCompositionProps) {
  if (mediaUrl) {
    return (
      <div className="absolute inset-0 select-none bg-canvas">
        <video
          src={mediaUrl}
          className="absolute inset-0 h-full w-full object-cover"
          controls
          muted
          loop
          playsInline
        />
      </div>
    );
  }

  return (
    <>
      <AdComposition {...comp} />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm transition-transform duration-200 group-hover:scale-110">
          <Play className="ml-0.5 h-5 w-5 fill-white text-white" />
        </span>
      </div>
      {video && (
        <>
          <span className="absolute right-2.5 top-2.5 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white/90 backdrop-blur-sm">
            {fmtDuration(video.durationSeconds)}
          </span>
          {video.captions?.[0] && (
            <span className="absolute inset-x-4 top-[58%] mx-auto w-fit max-w-full truncate rounded bg-black/55 px-2 py-0.5 text-center text-[10px] font-medium text-white backdrop-blur-sm">
              {video.captions[0]}
            </span>
          )}
        </>
      )}
    </>
  );
}
