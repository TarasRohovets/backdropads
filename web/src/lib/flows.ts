// Flows: multi-step creative pipelines on a visual board.
// A flow is prompt steps connected by arrows, ending in one or more output cards.
// Stored and executed by the API (see API_CONTRACT.md V3.0); run results come back per step.

import type { AttachmentKind } from "./attachments";
import type { Catalog } from "@/models";
import { DEFAULT_CATALOG, defaultModelId, findModel, modelUnitCost, snapDuration } from "./catalog";

export interface FlowAttachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  size: number;
  url: string | null;
}

export type StepStatus = "idle" | "queued" | "running" | "done" | "failed";

/** Run results are layered onto card data for display; they are never saved back. */
interface RunFields {
  status?: StepStatus;
  /** model that actually ran this step */
  usedModel?: string | null;
}

export interface PromptStepData extends RunFields {
  kind: "prompt";
  title: string;
  prompt: string;
  attachments: FlowAttachment[];
  /** Use the previous step's result as this step's input image (the chain). */
  usePrevious: boolean;
  resultSeed?: string | null;
  resultUrl?: string | null;
}

export interface OutputStepData extends RunFields {
  kind: "output";
  title: string;
  mode: "image" | "video";
  ratio: string;
  /** where the ad will run, when the card targets a platform; null = any (sized by ratio) */
  platform?: string | null;
  /** the format on that platform: feed, story, reel, short, video, pin, display */
  placement?: string | null;
  count: number;
  quality: "standard" | "high";
  brandKitId: string;
  /** model picked for this output (catalog default: Nano Banana Pro for images, Auto for video) */
  model: string;
  /** video outputs: clip length in seconds */
  durationSeconds?: number | null;
  /** what to make when no step is connected to this card (cards made by "Create with AI") */
  prompt?: string;
  /** a product photo this card builds on when no step is connected */
  attachments?: FlowAttachment[];
  resultSeeds?: string[];
  resultUrls?: (string | null)[];
  generationId?: string | null;
}

export type StepData = PromptStepData | OutputStepData;

export interface FlowNode {
  id: string;
  type: "prompt" | "output";
  position: { x: number; y: number };
  data: StepData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface FlowRunStep {
  nodeId: string;
  status: "queued" | "running" | "done" | "failed";
  error?: string | null;
  model?: string | null;
  resultSeed?: string | null;
  mediaUrl?: string | null;
  generationId?: string | null;
  resultSeeds: string[];
  resultUrls: (string | null)[];
}

export interface FlowRun {
  id: string;
  flowId: string;
  status: "running" | "completed" | "failed";
  error?: string | null;
  /** estimated provider cost of the run in USD */
  estimatedCostUsd: number;
  startedAt: string;
  finishedAt?: string | null;
  steps: FlowRunStep[];
}

export interface FlowDoc {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  createdAt: string;
  updatedAt: string;
  lastRun?: FlowRun | null;
  lastBatch?: FlowBatch | null;
  /** the flow's chat (loaded with the flow, not in the list) */
  chat?: FlowChatTurn[];
  /** saved states of the cards; v1 = how it started */
  versions?: FlowVersion[];
}

export interface FlowChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** the version this turn produced */
  version?: number | null;
  createdAt: string;
}

export interface FlowVersion {
  version: number;
  /** the request that made it, "Your edits", "Restored v1" */
  note: string;
  createdAt: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** A starter flow a new flow can begin from. */
export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  mode: "image" | "video";
  ratio: string;
  /** step titles, in order */
  steps: string[];
}

/** How many photos one "Run on photos" may take (the API enforces the same number). */
export const MAX_BATCH_PHOTOS = 10;

/** One photo of a batch and the run it produced. */
export interface FlowBatchItem {
  inputUrl: string;
  status: "queued" | "running" | "done" | "failed";
  error?: string | null;
  run?: FlowRun | null;
}

/** The same flow run once per photo, one after another. */
export interface FlowBatch {
  id: string;
  flowId: string;
  status: "running" | "completed" | "failed";
  /** estimated provider cost in USD */
  estimatedCostUsd: number;
  startedAt: string;
  finishedAt?: string | null;
  items: FlowBatchItem[];
}

// ---- factories -----------------------------------------------------------------------

export const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`;

export const promptStep = (x: number, y: number, title: string, prompt = "", usePrevious = true): FlowNode => ({
  id: uid("step"),
  type: "prompt",
  position: { x, y },
  data: { kind: "prompt", title, prompt, attachments: [], usePrevious },
});

export const outputStep = (x: number, y: number, mode: "image" | "video" = "image", count = 1, title = "Output"): FlowNode => ({
  id: uid("out"),
  type: "output",
  position: { x, y },
  data: { kind: "output", title, mode, ratio: mode === "video" ? "9:16" : "4:5", count, quality: "standard", brandKitId: "primary", model: defaultModelId(DEFAULT_CATALOG, mode) },
});

// ---- API normalization ---------------------------------------------------------------

/** The API stores flat step data; give each card the full, typed shape the board expects. */
export function normalizeNode(n: FlowNode): FlowNode {
  const d = n.data as unknown as Record<string, unknown>;
  if (n.type === "output") {
    return {
      ...n,
      data: {
        kind: "output",
        title: String(d.title ?? "Output"),
        mode: d.mode === "video" ? "video" : "image",
        ratio: String(d.ratio ?? "4:5"),
        count: Number(d.count ?? 3),
        quality: d.quality === "high" ? "high" : "standard",
        brandKitId: String(d.brandKitId ?? "primary"),
        model: String(d.model ?? defaultModelId(DEFAULT_CATALOG, d.mode === "video" ? "video" : "image")),
        durationSeconds: d.durationSeconds == null ? null : Number(d.durationSeconds),
        platform: d.platform && d.placement ? String(d.platform) : null,
        placement: d.platform && d.placement ? String(d.placement) : null,
        prompt: d.prompt ? String(d.prompt) : "",
        attachments: (d.attachments as FlowAttachment[] | undefined) ?? [],
      },
    };
  }
  return {
    ...n,
    data: {
      kind: "prompt",
      title: String(d.title ?? "Step"),
      prompt: String(d.prompt ?? ""),
      attachments: (d.attachments as FlowAttachment[] | undefined) ?? [],
      usePrevious: d.usePrevious !== false,
    },
  };
}

/** Strip run results before saving — only the author's settings are persisted. */
export function toSavable(n: FlowNode): FlowNode {
  const d = n.data;
  if (d.kind === "output") {
    const { kind, title, mode, ratio, count, quality, brandKitId, model, durationSeconds, platform, placement, prompt, attachments } = d;
    return { id: n.id, type: n.type, position: n.position, data: { kind, title, mode, ratio, count, quality, brandKitId, model, durationSeconds, platform: platform ?? null, placement: placement ?? null, prompt: prompt ?? "", attachments: attachments ?? [] } };
  }
  const { kind, title, prompt, attachments, usePrevious } = d;
  return { id: n.id, type: n.type, position: n.position, data: { kind, title, prompt, attachments, usePrevious } };
}

/** Layer a run's per-step results onto the cards for display. */
export function applyRun(nodes: FlowNode[], run: FlowRun | null | undefined): FlowNode[] {
  if (!run) return nodes;
  return nodes.map((n) => {
    const s = run.steps.find((x) => x.nodeId === n.id);
    if (!s) return n;
    const status: StepStatus = s.status;
    if (n.data.kind === "output") {
      return { ...n, data: { ...n.data, status, usedModel: s.model, resultSeeds: s.resultSeeds, resultUrls: s.resultUrls, generationId: s.generationId } };
    }
    return { ...n, data: { ...n.data, status, usedModel: s.model, resultSeed: s.resultSeed, resultUrl: s.mediaUrl } };
  });
}

// ---- execution order + cost estimate (display only; the API decides the real order) --

/** Topological order (Kahn). Nodes in cycles are appended last. */
export function runOrder(nodes: FlowNode[], edges: FlowEdge[]): string[] {
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  edges.forEach((e) => indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1));
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).sort((a, b) => a.position.x - b.position.x).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    edges.filter((e) => e.source === id).forEach((e) => {
      indeg.set(e.target, (indeg.get(e.target) ?? 1) - 1);
      if (indeg.get(e.target) === 0) queue.push(e.target);
    });
  }
  nodes.forEach((n) => !order.includes(n.id) && order.push(n.id));
  return order;
}

/** Estimated provider cost in USD: each prompt step is one image edit, outputs cost like generations. */
export function estimateCost(nodes: FlowNode[], catalog: Catalog = DEFAULT_CATALOG): number {
  return nodes.reduce((sum, n) => {
    if (n.data.kind === "prompt") return sum + catalog.editCostUsd;
    const d = n.data;
    const model = findModel(catalog.models, d.mode, d.model);
    return sum + modelUnitCost(model, d.quality, snapDuration(model, d.durationSeconds)) * d.count;
  }, 0);
}

// ---- flows as files ----------------------------------------------------------------------

/** What "Export" writes and "Import" reads. Steps, prompts and output settings only: no photos, no results. */
export interface FlowFile {
  format: "backdropads-flow";
  version: 1;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const toFlowFile = (flow: FlowDoc): FlowFile => ({
  format: "backdropads-flow",
  version: 1,
  name: flow.name,
  nodes: flow.nodes.map((n) => ({ ...n, data: { ...n.data, attachments: [] } }) as FlowNode),
  edges: flow.edges,
});

/** Saves the flow as a .json file through the browser. */
export function downloadFlow(flow: FlowDoc) {
  const blob = new Blob([JSON.stringify(toFlowFile(flow), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${flow.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "flow"}.backdropads-flow.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
