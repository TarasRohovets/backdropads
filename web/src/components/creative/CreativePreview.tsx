"use client";

import { CreativeFrame } from "./CreativeFrame";
import { AdComposition } from "./AdComposition";
import { VideoComposition } from "./VideoComposition";
import { CarouselComposition } from "./CarouselComposition";
import type { CarouselSlide, ConceptVideo, CreativeType } from "@/models";

interface CreativePreviewProps {
  creativeType: CreativeType;
  ratio: string;
  imageSeed: string;
  palette?: string[];
  hook: string;
  callToAction?: string;
  video?: ConceptVideo | null;
  slides?: CarouselSlide[] | null;
  brandName?: string;
  size?: "sm" | "md" | "lg";
  showRatio?: boolean;
  marks?: boolean;
  className?: string;
  /** Real generated media from a provider; overrides the mock composition. */
  mediaUrl?: string | null;
}

/** One component that renders any creative (image / video / carousel) inside the artboard frame. */
export function CreativePreview({
  creativeType,
  ratio,
  imageSeed,
  palette,
  hook,
  callToAction,
  video,
  slides,
  brandName,
  size = "md",
  showRatio = true,
  marks = true,
  className,
  mediaUrl,
}: CreativePreviewProps) {
  return (
    <CreativeFrame ratio={ratio} showRatio={showRatio} marks={marks} className={className}>
      {creativeType === "carousel" && slides?.length && !mediaUrl ? (
        <CarouselComposition
          slides={slides}
          palette={palette}
          callToAction={callToAction}
          ratio={ratio}
          size={size}
          brandName={brandName}
        />
      ) : creativeType === "video" ? (
        <VideoComposition
          imageSeed={imageSeed}
          palette={palette}
          hook={hook}
          callToAction={callToAction}
          ratio={ratio}
          video={video}
          size={size}
          brandName={brandName}
          mediaUrl={mediaUrl}
        />
      ) : (
        <AdComposition
          imageSeed={imageSeed}
          palette={palette}
          hook={hook}
          callToAction={callToAction}
          ratio={ratio}
          size={size}
          brandName={brandName}
          mediaUrl={mediaUrl}
        />
      )}
    </CreativeFrame>
  );
}
