"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, LibraryBig } from "lucide-react";
import { TemplatesApi } from "@/api/templates.api";
import { PLATFORMS, placementLabel } from "@/lib/taxonomy";
import { CreativePreview } from "@/components/creative/CreativePreview";
import { PlatformChip } from "@/components/shared/PlatformChip";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CATEGORIES = ["All", "E-commerce", "Direct response", "UGC", "Offer", "Launch", "Brand"];

export default function TemplatesPage() {
  const [category, setCategory] = useState("All");
  const [platform, setPlatform] = useState<string>("all");

  const templates = useQuery({ queryKey: ["templates"], queryFn: () => TemplatesApi.list() });

  const filtered = useMemo(() => {
    let list = templates.data ?? [];
    if (category !== "All") list = list.filter((t) => t.category === category);
    if (platform !== "all") list = list.filter((t) => t.platform === platform);
    return list;
  }, [templates.data, category, platform]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="eyebrow mb-2">Library</p>
      <h1 className="font-display text-3xl font-bold">Templates</h1>
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">
        Proven ad structures. Pick one and the wizard is pre-configured — just add your product.
      </p>

      {/* Category pills + platform filter */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
              category === c
                ? "border-iris bg-iris-soft text-foreground"
                : "border-border text-muted-foreground hover:border-muted-foreground/50"
            )}
          >
            {c}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          onClick={() => setPlatform("all")}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            platform === "all" ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground"
          )}
        >
          All platforms
        </button>
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPlatform(p.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              platform === p.id ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground hover:border-muted-foreground/50"
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.hue }} />
            {p.label}
          </button>
        ))}
      </div>

      {templates.isLoading ? (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={LibraryBig}
          title="No templates match"
          description="Try a different category or platform."
        />
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 pb-10 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map((t) => (
            <Link
              key={t.id}
              href={`/create?templateId=${t.id}`}
              className="group rounded-lg border border-border bg-card p-3 transition-colors hover:border-iris/50"
            >
              <CreativePreview
                creativeType="image"
                ratio={t.creativeType === "video" ? "9:16" : "4:5"}
                imageSeed={t.imageSeed}
                palette={t.palette}
                hook={t.hook}
                callToAction={t.callToAction}
                size="sm"
                showRatio={false}
              />
              <div className="mt-3">
                <h3 className="text-sm font-semibold leading-snug">{t.name}</h3>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{t.description}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <PlatformChip platform={t.platform} placementLabel={placementLabel(t.platform, t.placement)} />
                  <Badge variant="outline" className="border-border font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    {t.creativeType}
                  </Badge>
                </div>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-iris opacity-0 transition-opacity group-hover:opacity-100">
                  Use template <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
