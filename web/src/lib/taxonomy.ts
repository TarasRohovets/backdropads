import type { CreativeType, Placement, Platform } from "@/models";

// The one validation matrix, mirrored from API_CONTRACT.md.
// placement → valid creative types + derived aspect ratio, per platform.
export interface PlacementRule {
  placement: Placement;
  label: string;
  creativeTypes: CreativeType[];
  aspectRatio: string;
}

export const PLATFORM_RULES: Record<Platform, PlacementRule[]> = {
  instagram: [
    { placement: "feed", label: "Feed", creativeTypes: ["image", "carousel", "video"], aspectRatio: "4:5" },
    { placement: "story", label: "Story", creativeTypes: ["image", "video"], aspectRatio: "9:16" },
    { placement: "reel", label: "Reel", creativeTypes: ["video"], aspectRatio: "9:16" },
  ],
  facebook: [
    { placement: "feed", label: "Feed", creativeTypes: ["image", "carousel", "video"], aspectRatio: "1:1" },
    { placement: "story", label: "Story", creativeTypes: ["image", "video"], aspectRatio: "9:16" },
  ],
  tiktok: [
    { placement: "video", label: "Video", creativeTypes: ["video"], aspectRatio: "9:16" },
  ],
  youtube: [
    { placement: "short", label: "Short", creativeTypes: ["video"], aspectRatio: "9:16" },
    { placement: "video", label: "Video", creativeTypes: ["video"], aspectRatio: "16:9" },
  ],
  pinterest: [
    { placement: "pin", label: "Pin", creativeTypes: ["image", "video"], aspectRatio: "2:3" },
  ],
  googleDisplay: [
    { placement: "display", label: "Display", creativeTypes: ["image"], aspectRatio: "1:1" },
  ],
};

export interface PlatformMeta {
  id: Platform;
  label: string;
  short: string;
  hue: string; // brand hue used for the platform chip dot
}

export const PLATFORMS: PlatformMeta[] = [
  { id: "instagram", label: "Instagram", short: "IG", hue: "#E1306C" },
  { id: "facebook", label: "Facebook", short: "FB", hue: "#1877F2" },
  { id: "tiktok", label: "TikTok", short: "TT", hue: "#69C9D0" },
  { id: "youtube", label: "YouTube", short: "YT", hue: "#FF0000" },
  { id: "pinterest", label: "Pinterest", short: "PIN", hue: "#E60023" },
  { id: "googleDisplay", label: "Google Display", short: "GD", hue: "#4285F4" },
];

export const platformMeta = (id: Platform): PlatformMeta =>
  PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[0];

export const placementRule = (platform: Platform, placement: Placement): PlacementRule | undefined =>
  PLATFORM_RULES[platform]?.find((r) => r.placement === placement);

export const placementLabel = (platform: Platform, placement: Placement): string =>
  placementRule(platform, placement)?.label ?? placement;

export const CREATIVE_TYPES: { id: CreativeType; label: string; blurb: string }[] = [
  { id: "image", label: "Image", blurb: "A single still creative" },
  { id: "video", label: "Video", blurb: "Hook, voiceover and captions" },
  { id: "carousel", label: "Carousel", blurb: "A swipeable story in slides" },
];

// aspect ratio → CSS aspect-ratio value
export const RATIO_CSS: Record<string, string> = {
  "1:1": "1 / 1",
  "4:5": "4 / 5",
  "9:16": "9 / 16",
  "16:9": "16 / 9",
  "2:3": "2 / 3",
};

export const ratioCss = (ratio: string) => RATIO_CSS[ratio] ?? "1 / 1";

// picsum: deterministic mock imagery by seed
export const seedImage = (seed: string, w = 900, h = 1100) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;

export const ratioDims = (ratio: string, base = 900): { w: number; h: number } => {
  const [rw, rh] = (ratio ?? "1:1").split(":").map(Number);
  if (!rw || !rh) return { w: base, h: base };
  return rw >= rh
    ? { w: base, h: Math.round((base * rh) / rw) }
    : { w: Math.round((base * rw) / rh), h: base };
};

export const scoreTone = (score: number): "mint" | "honey" | "flame" =>
  score >= 75 ? "mint" : score >= 50 ? "honey" : "flame";
