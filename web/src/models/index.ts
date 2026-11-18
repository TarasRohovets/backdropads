// Types mirror API_CONTRACT.md in the project_ads_creator_api repo.

export type Platform =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "pinterest"
  | "googleDisplay";

export type Placement =
  | "feed"
  | "story"
  | "reel"
  | "short"
  | "video"
  | "pin"
  | "display";

export type CreativeType = "image" | "video" | "carousel";

export type AsyncStatus = "processing" | "completed" | "failed";
export type AdStatus = "draft" | "ready";

export interface Brief {
  productName: string;
  productUrl?: string | null;
  productDescription?: string | null;
  targetAudience: string;
  targetMarket: string;
  language: string;
  tone: string;
  offer?: string | null;
  keyBenefit: string;
  callToAction: string;
  referenceCreativeUrl?: string | null;
  /** more reference images after referenceCreativeUrl, in order (image 2, image 3, …) */
  referenceImageUrls?: string[];
  /** attached PDFs / text — an LLM reads them first; only its notes reach the image/video prompt */
  documentUrls?: string[];
  requiredText?: string | null;
  prohibitedClaims?: string | null;
}

/** Draft returned by a website scan — reviewed by the user before saving. */
export interface BrandScanResult {
  sourceUrl: string;
  brandName: string;
  logoUrl?: string | null;
  logoCandidates: string[];
  colors: string[];
  fonts: string[];
  context?: string | null;
}

export interface ConceptVideo {
  durationSeconds: number;
  voiceover: string;
  captions: string[];
}

export interface CarouselSlide {
  id: string;
  order: number;
  imageSeed: string;
  headline: string;
  text: string;
}

export interface Concept {
  id: string;
  generationId: string;
  creativeType: CreativeType;
  aspectRatio: string;
  hook: string;
  primaryText: string;
  callToAction: string;
  score: number;
  imageSeed: string;
  palette: string[];
  video?: ConceptVideo | null;
  slides?: CarouselSlide[] | null;
  /** which model produced it: "mock", "gpt-image-sunburst", "nano-banana", "seedance", "gemini-omni-flash" */
  model?: string | null;
  /** real media URL from a provider; null in mock mode (render from imageSeed) */
  mediaUrl?: string | null;
  /** refine loop: the concept this one was edited from (null for originals) */
  parentConceptId?: string | null;
  /** 1 for originals, parent + 1 per refinement */
  version?: number;
  /** the instruction that produced this version */
  editInstruction?: string | null;
}

/** One saved state of an ad's creative — the refine loop's history. */
export interface AdVersion {
  id: string;
  version: number;
  imageSeed: string;
  palette: string[];
  mediaUrl?: string | null;
  model: string;
  editInstruction?: string | null;
  createdAt: string;
}

export interface Generation {
  id: string;
  platform: Platform;
  placement: Placement;
  creativeType: CreativeType;
  aspectRatio: string;
  brief: Brief;
  roastId?: string | null;
  templateId?: string | null;
  /** product anchor this generation was built from */
  productId?: string | null;
  conceptCount?: number;
  styleId?: string | null;
  quality?: "standard" | "high";
  /** model picked for this generation ("auto" by default); concepts record the model actually used */
  model?: string;
  durationSeconds?: number | null;
  /** estimated provider cost in USD: the quote while it runs, then what really ran */
  estimatedCostUsd?: number;
  /** why it (or part of it) failed */
  error?: string | null;
  /** a working model to try instead when the picked one failed (catalog id) */
  suggestedModel?: string | null;
  status: AsyncStatus;
  createdAt: string;
  concepts: Concept[];
}

export interface Ad {
  id: string;
  name: string;
  platform: Platform;
  placement: Placement;
  creativeType: CreativeType;
  aspectRatio: string;
  status: AdStatus;
  hook: string;
  primaryText: string;
  callToAction: string;
  imageSeed: string;
  palette: string[];
  video?: ConceptVideo | null;
  slides?: CarouselSlide[] | null;
  score?: number | null;
  /** real media carried over from the saved concept; null in mock mode */
  mediaUrl?: string | null;
  /** product anchor, carried from the generation */
  productId?: string | null;
  model?: string;
  /** refine history, oldest first; empty until the first refinement */
  versions?: AdVersion[];
  currentVersion?: number;
  createdAt: string;
}

export interface RoastScores {
  hook: number;
  visual: number;
  offer: number;
  message: number;
  cta: number;
  platformFit: number;
}

export interface Recommendation {
  id: string;
  priority: number;
  title: string;
  problem: string;
  recommendation: string;
  improvedText?: string | null;
}

export interface ImprovedCopy {
  hook: string;
  primaryText: string;
  callToAction: string;
  imageSeed: string;
  palette: string[];
}

export interface Roast {
  id: string;
  adId?: string | null;
  sourceUrl?: string | null;
  sourceImageSeed: string;
  platform: Platform;
  targetMarket: string;
  language: string;
  status: AsyncStatus;
  createdAt: string;
  overallScore?: number | null;
  scores?: RoastScores | null;
  roastText?: string | null;
  recommendations?: Recommendation[] | null;
  improved?: ImprovedCopy | null;
}

export interface Template {
  id: string;
  name: string;
  platform: Platform;
  placement: Placement;
  creativeType: CreativeType;
  category: string;
  description: string;
  imageSeed: string;
  palette: string[];
  hook: string;
  callToAction: string;
}

export interface BrandKit {
  /** "primary" for the main kit; bk_xxx for additional kits */
  id?: string;
  brandName: string;
  logoUrl?: string | null;
  colors: string[];
  fonts: string[];
  tone: string;
  defaultCta: string;
  productInfo?: string | null;
  guidelines?: string | null;
  /** free-form brand context the AI reads before every generation */
  context?: string | null;
  websiteUrl?: string | null;
}

// ---- Workspaces, model catalog ----

/** A pickable generation model (GET /api/catalog). Costs are the provider's list price in USD — estimates. */
export interface AiModel {
  id: string;
  name: string;
  vendor: string;
  tagline: string;
  /** per image, or per second of video */
  costUsd: number;
  /** "high" quality: 2K images / 1080p video */
  costUsdHigh: number;
  unit: "image" | "second";
  durations: number[];
  defaultDuration: number;
  tags: string[];
  /** e.g. OmniHuman animates an attached photo */
  needsImage: boolean;
  /** uses attached photos (Gemini / OpenAI image models, photo-to-video avatars) */
  acceptsImages?: boolean;
  /** false = its API key isn't set (Settings → System shows which one) */
  configured?: boolean;
}

export interface ModelMenu {
  image: AiModel[];
  video: AiModel[];
}

/** Top organization layer — one per brand / store / client. */
export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
}

export interface WorkspaceList {
  workspaces: Workspace[];
  currentId: string;
  /** null = unlimited */
  limit: number | null;
}

export interface Catalog {
  models: ModelMenu;
  /** Pre-selected model per mode (API: AI:DefaultModels) — Nano Banana Pro for images. */
  defaultModels: { image: string; video: string };
  /** estimated provider cost of one image edit (refine, flow step) */
  editCostUsd: number;
  /** demo mode: nothing is sent to a provider and results are placeholders */
  mockMode: boolean;
}

/** A product anchor: the hero image generations reference (Brand Kit → Products). */
export interface Product {
  id: string;
  name: string;
  notes?: string | null;
  sourceImageUrl?: string | null;
  heroImageUrl?: string | null;
  heroImageSeed: string;
  palette: string[];
  rebranded: boolean;
  model: string;
  createdAt: string;
}
