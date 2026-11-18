import type { AiModel, Catalog, ModelMenu } from "@/models";

const LONG = [5, 10, 15];

function m(id: string, name: string, vendor: string, tagline: string, costUsd: number, costUsdHigh: number, tags: string[]): AiModel {
  return { id, name, vendor, tagline, costUsd, costUsdHigh, unit: "image", durations: [], defaultDuration: 0, tags, needsImage: false };
}

function v(id: string, name: string, vendor: string, tagline: string, costUsd: number, costUsdHigh: number, tags: string[], durations: number[], defaultDuration: number): AiModel {
  return { id, name, vendor, tagline, costUsd, costUsdHigh, unit: "second", durations, defaultDuration, tags, needsImage: false };
}

/**
 * Mirror of GET /api/catalog. The API is the source of truth — this is only the first-paint fallback;
 * `useCatalog()` swaps in the live catalog (which also knows which models have an API key).
 */
export const DEFAULT_CATALOG: Catalog = {
  defaultModels: { image: "nano-banana-pro", video: "auto" },
  editCostUsd: 0.034,
  mockMode: false,
  models: {
    image: [
      m("auto", "Auto", "BackdropAds", "Best model for the job, with automatic fallback", 0.053, 0.211, ["Recommended"]),
      m("gpt-image-flare", "GPT Image 2.6 Flare", "OpenAI", "OpenAI's fast model — sharp text and layouts, great for ad copy", 0.053, 0.211, ["New", "Best text"]),
      m("gpt-image-sunburst", "GPT Image 2.6 Sunburst", "OpenAI", "OpenAI's most detailed model — for intricate, polished visuals", 0.053, 0.211, []),
      m("nano-banana", "Nano Banana 2.1", "Google", "Google's everyday model — fast, photoreal, strong product consistency", 0.034, 0.05, ["Fast"]),
      m("nano-banana-pro", "Nano Banana Pro", "Google", "Highest fidelity and reasoning for complex scenes", 0.134, 0.134, ["Premium"]),
      m("seedream", "Seedream 5.5", "ByteDance", "Rich, stylised visuals and posters", 0.03, 0.0405, []),
      m("seedream-flash", "Seedream 5 Flash", "ByteDance", "Budget option for quick explorations", 0.027, 0.027, ["Cheapest"]),
      m("flux", "FLUX 3", "Black Forest Labs", "Photorealism and lifestyle scenes", 0.048, 0.192, []),
    ],
    video: [
      v("auto", "Auto", "BackdropAds", "Best model for the job, with automatic fallback", 0.231, 0.569, ["Recommended"], LONG, 10),
      v("seedance", "Seedance 2.5", "ByteDance", "Top-ranked motion, multi-shot scenes, native audio", 0.231, 0.569, ["Top rated"], LONG, 10),
      v("seedance-flash", "Seedance 2.5 Flash", "ByteDance", "Seedance quality, quicker and cheaper (720p)", 0.15, 0.15, ["Fast"], LONG, 10),
      v("gemini-omni-flash", "Gemini Omni 1.2 Flash", "Google", "Google's video model — native audio, works with just a Google key", 0.07, 0.104, [], LONG, 10),
      v("kling", "Kling 3.0", "Kuaishou", "Realistic people and product motion (1080p adds native audio)", 0.084, 0.168, [], LONG, 10),
      v("wan", "Wan 3.0", "Alibaba", "Open model with smooth, natural motion", 0.1, 0.2, [], LONG, 10),
      { ...v("omnihuman", "OmniHuman 2", "ByteDance", "Talking-avatar UGC from one photo, lip-synced", 0.105, 0.105, ["UGC"], LONG, 10), needsImage: true },
    ],
  },
};

/** "$0.13", "$1.60", "$0.007" — an estimate at the provider's list price. */
export const usd = (amount: number): string =>
  amount === 0 ? "$0" : amount < 0.01 ? `$${amount.toFixed(3)}` : `$${amount.toFixed(2)}`;

/** Image models that take attached photos as input (mirrors the API's PhotoInputModels). */
const PHOTO_INPUT_MODELS = new Set(["auto", "gpt-image-flare", "gpt-image-sunburst", "nano-banana", "nano-banana-pro"]);

/** True when the model actually uses attached photos. */
export const modelUsesPhotos = (m: AiModel): boolean =>
  m.acceptsImages ?? (m.needsImage || (m.unit === "image" && PHOTO_INPUT_MODELS.has(m.id)));

/** The model new generations start on (images: Nano Banana Pro). */
export const defaultModelId = (catalog: Catalog, mode: "image" | "video"): string =>
  catalog.defaultModels?.[mode] ?? DEFAULT_CATALOG.defaultModels[mode];

export const findModel = (menu: ModelMenu, mode: "image" | "video", id?: string | null): AiModel =>
  menu[mode].find((x) => x.id === (id || "auto")) ?? menu[mode][0];

/** Estimated provider cost (USD) of one image, or one clip of `seconds`. */
export const modelUnitCost = (model: AiModel, quality: "standard" | "high" | string | null | undefined, seconds?: number | null): number => {
  const rate = quality === "high" ? model.costUsdHigh : model.costUsd;
  return model.unit === "second" ? rate * (seconds || model.defaultDuration || 1) : rate;
};

/** Snap a length to the model's allowed ones (nearest, ties go shorter). */
export const snapDuration = (model: AiModel, seconds?: number | null): number => {
  if (!model.durations.length) return 0;
  if (!seconds) return model.defaultDuration;
  return [...model.durations].sort((a, b) => Math.abs(a - seconds) - Math.abs(b - seconds) || a - b)[0];
};
