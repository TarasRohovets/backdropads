"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Flame, History as HistoryIcon, Loader2, WandSparkles } from "lucide-react";
import { GenerationsApi } from "@/api/generations.api";
import { RoastsApi } from "@/api/roasts.api";
import { placementLabel, platformMeta, scoreTone } from "@/lib/taxonomy";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { ANALYZE_ENABLED } from "@/lib/features";
import { cn } from "@/lib/utils";

const TONE_TEXT: Record<string, string> = {
  mint: "text-mint",
  honey: "text-honey",
  flame: "text-flame",
};

interface HistoryItem {
  id: string;
  kind: "generation" | "analysis";
  href: string;
  title: string;
  detail: string;
  status: string;
  score?: number | null;
  createdAt: string;
}

export default function HistoryPage() {
  const generations = useQuery({ queryKey: ["generations"], queryFn: () => GenerationsApi.list() });
  const roasts = useQuery({ queryKey: ["roasts"], queryFn: () => RoastsApi.list(), enabled: ANALYZE_ENABLED });

  const loading = generations.isLoading || roasts.isLoading;

  const items: HistoryItem[] = [
    ...(generations.data ?? []).map((g): HistoryItem => ({
      id: g.id,
      kind: "generation",
      href: `/generations/${g.id}`,
      title: `Generated ${g.creativeType} concepts — ${g.brief.productName}`,
      detail: `${platformMeta(g.platform).label} ${placementLabel(g.platform, g.placement)}`,
      status: g.status,
      createdAt: g.createdAt,
    })),
    ...(roasts.data ?? []).map((r): HistoryItem => ({
      id: r.id,
      kind: "analysis",
      href: `/analyses/${r.id}`,
      title: r.adId ? "Analyzed a saved ad" : "Analyzed an external ad",
      detail: `${platformMeta(r.platform).label} · ${r.targetMarket}`,
      status: r.status,
      score: r.overallScore,
      createdAt: r.createdAt,
    })),
  ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="eyebrow mb-2">Activity</p>
      <h1 className="font-display text-3xl font-bold">History</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {ANALYZE_ENABLED ? "Every generation and analysis, newest first." : "Every generation, newest first."}
      </p>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={HistoryIcon}
          title="Nothing here yet"
          description={ANALYZE_ENABLED ? "Generations and analyses will show up here as you work." : "Generations will show up here as you work."}
          actionLabel="Create your first ad"
          actionHref="/create"
        />
      ) : (
        <ol className="mt-8 space-y-2 pb-10">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:border-muted-foreground/40"
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                    item.kind === "generation" ? "bg-iris-soft" : "bg-flame-soft"
                  )}
                >
                  {item.kind === "generation" ? (
                    <WandSparkles className="h-4 w-4 text-iris" />
                  ) : (
                    <Flame className="h-4 w-4 text-flame" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                </div>
                {item.status === "processing" ? (
                  <Badge variant="outline" className="border-honey/40 text-[10px] text-honey">
                    Processing
                  </Badge>
                ) : typeof item.score === "number" ? (
                  <span className={cn("font-mono text-sm font-bold", TONE_TEXT[scoreTone(item.score)])}>
                    {item.score}
                  </span>
                ) : null}
                <span className="w-24 shrink-0 text-right text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
