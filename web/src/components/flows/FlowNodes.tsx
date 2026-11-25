"use client";

import { targetLabel } from "./FlowResults";
import { createContext, memo, useContext } from "react";
import Link from "next/link";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ArrowRight, Clapperboard, FileText, Image as ImageIcon, Link2, Loader2, Play, Plus } from "lucide-react";
import type { OutputStepData, PromptStepData, StepStatus } from "@/lib/flows";
import { seedImage } from "@/lib/taxonomy";
import { cn } from "@/lib/utils";

/** Board actions the cards can call (add the next step, open the inspector). */
export const FlowActions = createContext<{
  addAfter: (id: string) => void;
  select: (id: string) => void;
  indexOf: (id: string) => number;
}>({ addAfter: () => {}, select: () => {}, indexOf: () => 0 });

const handleClass = "!h-3.5 !w-3.5 !rounded-full !border-2 !border-iris !bg-background";

function StatusDot({ status = "idle" }: { status?: StepStatus }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full",
        status === "done"
          ? "bg-mint shadow-[0_0_8px_hsl(var(--mint))]"
          : status === "failed"
            ? "bg-destructive shadow-[0_0_8px_hsl(var(--destructive))]"
            : status === "queued"
              ? "bg-honey"
              : "bg-muted-foreground/40"
      )}
      title={status}
    />
  );
}

export function PromptNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as PromptStepData;
  const { addAfter, indexOf } = useContext(FlowActions);
  const counts = {
    image: d.attachments.filter((a) => a.kind === "image").length,
    pdf: d.attachments.filter((a) => a.kind === "pdf").length,
    text: d.attachments.filter((a) => a.kind === "text").length,
  };
  const hasFiles = d.attachments.length > 0;

  return (
    <div
      className={cn(
        // Solid card, no backdrop blur: blur on every card makes pan/zoom heavy.
        "group relative w-[270px] rounded-2xl bg-card p-4 shadow-[0_16px_36px_-28px_hsl(var(--iris)/0.7)] transition-colors",
        selected ? "ring-neon" : "border border-border hover:border-iris/50"
      )}
    >
      <Handle type="target" position={Position.Left} className={handleClass} />

      <div className="flex items-center gap-2">
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-iris/15 px-1.5 font-mono text-[10px] font-bold text-iris">
          {String(indexOf(id) + 1).padStart(2, "0")}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-bold">{d.title || "Prompt"}</p>
        <StatusDot status={d.status} />
      </div>

      <p className={cn("mt-2.5 line-clamp-3 text-xs leading-relaxed", d.prompt ? "text-foreground/85" : "italic text-muted-foreground")}>
        {d.prompt || "Click to write this step's prompt…"}
      </p>

      {(hasFiles || d.usePrevious) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {d.usePrevious && indexOf(id) > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground" title="Uses the previous step's result">
              <Link2 className="h-3 w-3" /> chained
            </span>
          )}
          {counts.image > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              <ImageIcon className="h-3 w-3" /> {counts.image}
            </span>
          )}
          {counts.pdf > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-flame/15 px-2 py-0.5 text-[10px] font-semibold text-flame">
              <FileText className="h-3 w-3" /> {counts.pdf} PDF
            </span>
          )}
          {counts.text > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-iris/15 px-2 py-0.5 text-[10px] font-semibold text-iris">
              <FileText className="h-3 w-3" /> {counts.text} text
            </span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} className={handleClass} />

      {/* Quick-add the next step, already connected */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          addAfter(id);
        }}
        className="nodrag absolute -right-11 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-all hover:border-primary hover:bg-primary hover:text-primary-foreground group-hover:opacity-100"
        aria-label="Add next step"
        title="Add next step"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

export function OutputNode({ data, selected }: NodeProps) {
  const d = data as unknown as OutputStepData;
  const Icon = d.mode === "video" ? Clapperboard : ImageIcon;
  const tiles = Array.from({ length: Math.min(d.count, 4) });

  return (
    <div
      className={cn(
        "relative w-[260px] rounded-2xl bg-card p-4 shadow-[0_16px_36px_-28px_hsl(var(--primary)/0.6)] transition-colors",
        selected ? "ring-neon" : "border border-primary/40 hover:border-primary/70"
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-3.5 !w-3.5 !rounded-full !border-2 !border-primary !bg-background" />

      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground glow-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{d.title || "Output"}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {d.mode} ×{d.count} · {targetLabel(d)}
            {d.mode === "video" && d.durationSeconds ? ` · ${d.durationSeconds}s` : ""}
            {d.quality === "high" ? (d.mode === "video" ? " · 1080p" : " · HQ") : ""}
            {d.model && d.model !== "auto" ? ` · ${d.model}` : ""}
          </p>
        </div>
        <StatusDot status={d.status} />
      </div>

      {/* A card made by "Create with AI" carries its own prompt (and product photo). */}
      {d.prompt && (
        <div className="mt-2.5 flex gap-2">
          {d.attachments?.[0]?.url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.attachments[0].url} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
          )}
          <p className="line-clamp-3 text-[11px] leading-snug text-muted-foreground">{d.prompt}</p>
        </div>
      )}

      <div className={cn("mt-3 grid gap-1.5", tiles.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
        {tiles.map((_, i) => {
          const seed = d.resultSeeds?.[i];
          const url = d.resultUrls?.[i];
          return (
            <div key={i} className="relative aspect-square overflow-hidden rounded-xl border border-border bg-secondary/50">
              {d.status === "running" ? (
                <div className="h-full w-full bg-[linear-gradient(110deg,hsl(var(--secondary))_30%,hsl(var(--primary)/0.2)_50%,hsl(var(--secondary))_70%)] bg-[length:400px_100%] animate-shimmer" />
              ) : seed ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url || seedImage(seed, 300, 300)} alt="" className="h-full w-full object-cover" />
                  {d.mode === "video" && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
                        <Play className="ml-0.5 h-3.5 w-3.5 fill-white text-white" />
                      </span>
                    </span>
                  )}
                </>
              ) : (
                <span className="flex h-full items-center justify-center">
                  <Icon className="h-4 w-4 text-muted-foreground/40" />
                </span>
              )}
            </div>
          );
        })}
      </div>
      {d.count > 4 && <p className="mt-1.5 text-center font-mono text-[10px] text-muted-foreground">+{d.count - 4} more</p>}
      {d.generationId && d.status === "done" && (
        <Link
          href={`/generations/${d.generationId}`}
          onClick={(e) => e.stopPropagation()}
          className="nodrag mt-3 flex h-8 items-center justify-center gap-1.5 rounded-full bg-primary text-xs font-bold text-primary-foreground glow-primary transition-all hover:brightness-110"
        >
          Open results <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

// Memoised: a card only re-renders when its own data / selection changes, not on every drag frame of another card.
export const nodeTypes = { prompt: memo(PromptNode), output: memo(OutputNode) };
