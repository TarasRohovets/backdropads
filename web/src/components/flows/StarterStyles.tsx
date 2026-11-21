"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clapperboard, Image as ImageIcon } from "lucide-react";
import { FlowsApi } from "@/api/flows.api";

/**
 * The quickest way to an ad: pick a ready-made style (a starter flow), add photos, get an ad for each.
 * Each card makes the flow and opens it with the photo picker ready.
 */
export function StarterStyles() {
  const templates = useQuery({ queryKey: ["flow-templates"], queryFn: () => FlowsApi.templates(), staleTime: Infinity });
  const styles = (templates.data ?? []).filter((t) => t.id !== "blank");
  if (styles.length === 0) return null;

  return (
    <section className="mx-auto mt-12 max-w-5xl">
      <div className="mb-4 text-center">
        <h2 className="font-display text-xl font-bold">Or start from a ready-made ad style</h2>
        <p className="mt-1 text-sm text-muted-foreground">Pick one, add up to 10 photos, and get an ad for each. Nothing to write.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {styles.map((t) => (
          <Link
            key={t.id}
            href={`/flows?template=${t.id}`}
            className="card-hover group flex flex-col rounded-2xl border border-border bg-card/60 p-4 backdrop-blur-sm"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-iris/15 text-iris">
              {t.mode === "video" ? <Clapperboard className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
            </span>
            <span className="mt-3 text-sm font-bold">{t.name}</span>
            <span className="mt-1 flex-1 text-xs leading-snug text-muted-foreground">{t.description}</span>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
              Use this style <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
