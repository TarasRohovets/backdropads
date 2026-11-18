"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Images, Loader2, Trash2 } from "lucide-react";
import type { Concept, Generation } from "@/models";
import { GenerationsApi } from "@/api/generations.api";
import { CreativePreview } from "@/components/creative/CreativePreview";
import { EmptyState } from "@/components/shared/EmptyState";
import { DeleteCreationDialog, type CreationRef } from "@/components/shared/DeleteCreationDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ratioCss } from "@/lib/taxonomy";

type Tile =
  | { kind: "concept"; key: string; generation: Generation; concept: Concept }
  | { kind: "pending"; key: string; generation: Generation }
  | { kind: "failed"; key: string; generation: Generation };

/** Newest first: every generated concept (incl. refined versions); generations still running show as a tile too. */
function tilesFrom(generations: Generation[], limit: number): Tile[] {
  const tiles: Tile[] = [];
  const sorted = [...generations].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  for (const g of sorted) {
    if (g.status === "processing") {
      tiles.push({ kind: "pending", key: g.id, generation: g });
    } else if (g.status === "failed") {
      tiles.push({ kind: "failed", key: g.id, generation: g });
    } else {
      // Latest versions first, so a refinement shows up ahead of its original.
      const concepts = [...g.concepts].sort((a, b) => (b.version ?? 1) - (a.version ?? 1));
      for (const c of concepts) tiles.push({ kind: "concept", key: c.id, generation: g, concept: c });
    }
    if (tiles.length >= limit) break;
  }
  return tiles.slice(0, limit);
}

/** Dashboard strip of what you actually generated in this workspace — just the images and videos. */
export function RecentCreations({ limit = 8 }: { limit?: number }) {
  const [toDelete, setToDelete] = useState<CreationRef | null>(null);
  const generations = useQuery({
    queryKey: ["generations"],
    queryFn: () => GenerationsApi.list(),
    // Keep polling while something is still generating so the tile flips to the result.
    refetchInterval: (q) => (q.state.data?.some((g) => g.status === "processing") ? 3000 : false),
  });

  if (generations.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/5] rounded-2xl" />
        ))}
      </div>
    );
  }

  if (generations.isError) {
    return (
      <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Couldn't reach the BackdropAds API. Start it, then refresh.
      </p>
    );
  }

  const tiles = tilesFrom(generations.data ?? [], limit);
  if (tiles.length === 0) {
    return (
      <EmptyState
        icon={Images}
        title="Nothing generated yet"
        description="Your images and videos land here as soon as you generate them. Type a prompt above to make your first one."
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.key} className="group relative">
          <Link href={`/generations/${t.generation.id}`} className="card-hover block rounded-2xl">
            {t.kind === "failed" ? (
              <div
                className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-flame/40 bg-flame-soft px-3 text-center text-xs text-muted-foreground"
                style={{ aspectRatio: ratioCss(t.generation.aspectRatio) }}
              >
                <AlertTriangle className="h-5 w-5 text-flame" />
                Couldn't generate.
                <span className="font-semibold text-foreground">Tap to try again</span>
              </div>
            ) : t.kind === "pending" ? (
              <div
                className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 text-xs text-muted-foreground"
                style={{ aspectRatio: ratioCss(t.generation.aspectRatio) }}
              >
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Generating {t.generation.creativeType}…
              </div>
            ) : (
              <CreativePreview
                creativeType={t.concept.creativeType}
                ratio={t.concept.aspectRatio}
                imageSeed={t.concept.imageSeed}
                palette={t.concept.palette}
                hook={t.concept.hook}
                callToAction={t.concept.callToAction}
                video={t.concept.video}
                slides={t.concept.slides}
                brandName={t.generation.brief.productName}
                mediaUrl={t.concept.mediaUrl}
                size="sm"
                showRatio={false}
                marks={false}
              />
            )}
          </Link>
          {t.kind === "concept" && (
            <button
              type="button"
              aria-label={`Delete ${t.concept.creativeType === "video" ? "video" : "image"}`}
              onClick={() => setToDelete({ generationId: t.generation.id, conceptId: t.concept.id, creativeType: t.concept.creativeType })}
              className="absolute right-2 top-2 rounded-full bg-black/60 p-2 text-white backdrop-blur transition-opacity hover:bg-flame focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      <DeleteCreationDialog target={toDelete} onClose={() => setToDelete(null)} />
    </div>
  );
}
