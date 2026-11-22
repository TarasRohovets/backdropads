"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, ChevronDown, ChevronUp, Clock, Download, ExternalLink, Loader2, Play } from "lucide-react";
import { FlowsApi } from "@/api/flows.api";
import { placementLabel, platformMeta, seedImage } from "@/lib/taxonomy";
import type { FlowBatch, FlowNode, FlowRun, FlowRunStep, OutputStepData } from "@/lib/flows";
import type { Placement, Platform } from "@/models";
import { cn } from "@/lib/utils";

const isVideoFile = (url: string) => /\.(mp4|webm|mov)(\?|$)/i.test(url);

/** "Instagram Reel · 9:16" for a card that targets a platform, else just the size. */
export function targetLabel(d: OutputStepData): string {
  if (d.platform && d.placement)
    return `${platformMeta(d.platform as Platform).label} ${placementLabel(d.platform as Platform, d.placement as Placement)} · ${d.ratio}`;
  return d.ratio;
}

interface Tile {
  key: string;
  url: string | null;
  seed: string | null;
  generationId: string;
  label: string;
  video: boolean;
}

/** Every finished ad of one run: one tile per result of each output card. */
function tilesOf(run: FlowRun | null | undefined, nodes: FlowNode[], prefix: string): Tile[] {
  if (!run) return [];
  const tiles: Tile[] = [];
  for (const step of run.steps as FlowRunStep[]) {
    if (!step.generationId || step.status !== "done") continue;
    const node = nodes.find((n) => n.id === step.nodeId);
    const data = node?.type === "output" ? (node.data as OutputStepData) : null;
    const count = Math.max(step.resultUrls?.length ?? 0, step.resultSeeds?.length ?? 0, 1);
    for (let i = 0; i < count; i++) {
      const url = step.resultUrls?.[i] ?? null;
      tiles.push({
        key: `${prefix}-${step.nodeId}-${i}`,
        url,
        seed: step.resultSeeds?.[i] ?? null,
        generationId: step.generationId,
        label: data ? (data.platform && data.placement ? targetLabel(data).split(" · ")[0] : data.ratio) : "",
        video: data?.mode === "video" || (!!url && isVideoFile(url)),
      });
    }
  }
  return tiles;
}

function ResultTile({ tile }: { tile: Tile }) {
  const playable = tile.url && isVideoFile(tile.url);
  return (
    <div className="group relative h-36 shrink-0 overflow-hidden rounded-xl border border-border bg-secondary/50">
      {playable ? (
        <video src={tile.url!} muted loop playsInline preload="metadata" className="h-full w-auto"
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
      ) : tile.url || tile.seed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tile.url || seedImage(tile.seed!, 300, 360)} alt="Generated ad" className="h-full w-auto min-w-24 object-cover" loading="lazy" />
      ) : (
        <span className="flex h-full w-28 items-center justify-center text-xs text-muted-foreground">Ready</span>
      )}
      {tile.video && !playable && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55"><Play className="ml-0.5 h-3.5 w-3.5 fill-white text-white" /></span>
        </span>
      )}
      {tile.label && (
        <span className="absolute left-1.5 top-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
          {tile.label}
        </span>
      )}
      <div className="absolute inset-x-1.5 bottom-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Link href={`/generations/${tile.generationId}`} className="flex h-7 flex-1 items-center justify-center gap-1 rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
          <ExternalLink className="h-3 w-3" /> Open
        </Link>
        {tile.url && (
          <a href={tile.url} download target="_blank" rel="noreferrer" aria-label="Download" title="Download"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground">
            <Download className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * The strip under the board: every ad the flow has produced — from the last run and from the last
 * "Run on photos" — with a way to open or download each. Also shows progress while photos are processed.
 */
export function FlowResults({
  flowId,
  nodes,
  run,
  batch,
  onBatchChange,
}: {
  flowId: string;
  nodes: FlowNode[];
  run: FlowRun | null;
  batch: FlowBatch | null;
  onBatchChange: (batch: FlowBatch | null) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const batchRunning = batch?.status === "running";

  // Progress of "Run on photos" (photos are processed one after another).
  useQuery({
    queryKey: ["flow-batch", flowId, batch?.id],
    queryFn: async () => {
      const latest = await FlowsApi.getBatch(flowId);
      if (latest && latest.id === batch?.id) {
        if (latest.status !== "running") {
          qc.invalidateQueries({ queryKey: ["wallet"] });
          qc.invalidateQueries({ queryKey: ["system"] });
        }
        onBatchChange(latest);
      }
      return latest;
    },
    enabled: !!batchRunning,
    refetchInterval: 2500,
  });

  const runTiles = run?.status === "running" ? [] : tilesOf(run, nodes, "run");
  const items = batch?.items ?? [];
  const batchTiles = items.flatMap((item, i) => tilesOf(item.run, nodes, `photo${i}`));
  const total = runTiles.length + batchTiles.length;
  const finished = items.filter((i) => i.status === "done" || i.status === "failed").length;
  const failed = items.filter((i) => i.status === "failed").length;
  if (!batch && total === 0) return null;

  return (
    <div className="border-t border-border bg-card/60 backdrop-blur-md">
      <div className="flex items-center gap-3 px-4 py-2.5">
        {batchRunning ? <Loader2 className="h-4 w-4 animate-spin text-iris" /> : <Check className="h-4 w-4 text-mint" />}
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          Results
          <span className="font-normal text-muted-foreground">
            {" "}· {total} ad{total === 1 ? "" : "s"}
            {batch && (batchRunning ? ` · ${finished} of ${items.length} photos finished` : ` · ${items.length - failed} of ${items.length} photos`)}
            {failed > 0 && !batchRunning && ` · ${failed} failed`}
          </span>
        </p>
        {batch && !batchRunning && (
          <button type="button" onClick={() => onBatchChange(null)} className="text-xs text-muted-foreground hover:text-foreground">
            Clear photo results
          </button>
        )}
        <button type="button" aria-label={open ? "Collapse results" : "Show results"} onClick={() => setOpen((o) => !o)} className="rounded p-1 text-muted-foreground hover:text-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div className="flex items-stretch gap-4 overflow-x-auto px-4 pb-3 scrollbar-thin">
          {runTiles.length > 0 && (
            <div className="flex shrink-0 flex-col gap-1.5">
              <p className="text-[11px] font-semibold text-muted-foreground">Last run</p>
              <div className="flex gap-2">{runTiles.map((t) => <ResultTile key={t.key} tile={t} />)}</div>
            </div>
          )}
          {items.map((item, i) => {
            const tiles = tilesOf(item.run, nodes, `photo${i}`);
            return (
              <div key={`${item.inputUrl}-${i}`} className="flex shrink-0 flex-col gap-1.5">
                <p className={cn("flex items-center gap-1.5 text-[11px] font-semibold", item.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.inputUrl} alt="" className="h-4 w-4 rounded object-cover" loading="lazy" />
                  Photo {i + 1}
                  {item.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-iris" />}
                  {item.status === "queued" && <Clock className="h-3 w-3" />}
                  {item.status === "failed" && <AlertCircle className="h-3 w-3" />}
                </p>
                <div className="flex gap-2">
                  {tiles.map((t) => <ResultTile key={t.key} tile={t} />)}
                  {tiles.length === 0 && (
                    <div
                      title={item.error ?? undefined}
                      className="flex h-36 w-28 shrink-0 items-center justify-center rounded-xl border border-dashed border-border px-2 text-center text-[11px] text-muted-foreground"
                    >
                      {item.status === "failed" ? item.error || "Couldn't finish" : item.status === "running" ? "Working…" : "Waiting"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
