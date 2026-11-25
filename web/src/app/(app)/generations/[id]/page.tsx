"use client";

import { use, useEffect, useState } from "react";
import { useCatalog } from "@/hooks/use-catalog";
import { findModel, modelUnitCost, snapDuration, usd } from "@/lib/catalog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Copy,
  Download,
  Flame,
  Loader2,
  PenLine,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Concept, Generation } from "@/models";
import { GenerationsApi } from "@/api/generations.api";
import { AdsApi } from "@/api/ads.api";
import { apiError } from "@/api/client";
import { placementLabel, platformMeta } from "@/lib/taxonomy";
import { CreativePreview } from "@/components/creative/CreativePreview";
import { DeleteCreationDialog, type CreationRef } from "@/components/shared/DeleteCreationDialog";
import { RefineBox, VersionStrip } from "@/components/creative/RefineBox";
import { PlatformChip } from "@/components/shared/PlatformChip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ANALYZE_ENABLED } from "@/lib/features";
import { cn } from "@/lib/utils";
import { FolderMenuItems, NewFolderDialog, useFolders } from "@/components/folders/FolderParts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Folder } from "@/models";

const STAGES = [
  "Understanding your product…",
  "Building creative concepts…",
  "Writing hooks…",
  "Designing the visual…",
  "Optimizing for the platform…",
];

function GenerationProgress({ generation }: { generation: Generation }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 1400);
    return () => clearInterval(t);
  }, []);

  const meta = platformMeta(generation.platform);
  const label =
    stage === STAGES.length - 1
      ? `Optimizing for ${meta.label}…`
      : STAGES[stage];

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-16">
      {/* A developing artboard — the creative literally takes shape */}
      <div
        className="artboard relative w-full max-w-[260px] overflow-hidden rounded-md border border-border bg-canvas"
        style={{ aspectRatio: generation.aspectRatio.replace(":", " / ") }}
      >
        <span className="artboard-marks" aria-hidden />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background:
              "linear-gradient(120deg, transparent 30%, hsl(var(--iris) / 0.25) 50%, transparent 70%)",
            backgroundSize: "800px 100%",
          }}
        />
        {/* scan line */}
        <div className="absolute inset-x-0 top-0 h-1/4 animate-scan bg-gradient-to-b from-transparent via-iris/20 to-transparent" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Sparkles className="h-6 w-6 animate-pulse-soft text-iris" />
          <span className="font-mono text-[11px] tracking-widest text-muted-foreground">
            {generation.aspectRatio}
          </span>
        </div>
      </div>

      <div className="mt-10 h-6 text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="text-sm font-medium text-foreground"
          >
            {label}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* stage dots */}
      <div className="mt-4 flex gap-1.5">
        {STAGES.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1 rounded-full transition-all duration-500",
              i <= stage ? "w-6 bg-iris" : "w-2 bg-secondary"
            )}
          />
        ))}
      </div>

      <p className="mt-8 max-w-xs text-center text-xs leading-relaxed text-muted-foreground">
        Generating {generation.creativeType} concepts for {meta.label}{" "}
        {placementLabel(generation.platform, generation.placement)} — usually under a minute.
      </p>
    </div>
  );
}

/** Group a generation's concepts into refine chains: [root, v2, v3…] sorted by version. */
function groupVersions(concepts: Concept[]): Concept[][] {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const rootOf = (c: Concept): string => {
    let cur = c;
    const seen = new Set<string>();
    while (cur.parentConceptId && byId.has(cur.parentConceptId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parentConceptId)!;
    }
    return cur.id;
  };
  const chains = new Map<string, Concept[]>();
  for (const c of concepts) {
    const root = rootOf(c);
    if (!chains.has(root)) chains.set(root, []);
    chains.get(root)!.push(c);
  }
  return [...chains.values()].map((chain) => chain.sort((a, b) => (a.version ?? 1) - (b.version ?? 1)));
}

function ConceptCard({ versions, generation, index }: { versions: Concept[]; generation: Generation; index: number }) {
  const router = useRouter();
  const qc = useQueryClient();

  // Show the latest version by default; the strip lets you step back.
  const latest = versions[versions.length - 1];
  const [current, setCurrent] = useState<number>(latest.version ?? 1);
  useEffect(() => setCurrent(latest.version ?? 1), [latest.id, latest.version]);
  const concept = versions.find((v) => (v.version ?? 1) === current) ?? latest;

  const refine = useMutation({
    mutationFn: (instruction: string) => GenerationsApi.refineConcept(generation.id, concept.id, instruction),
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: ["generation", generation.id] });
      setCurrent(next.version ?? current + 1);
      toast.success(`Version ${next.version} ready`);
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const [toDelete, setToDelete] = useState<CreationRef | null>(null);

  const folders = useFolders();
  const [newFolder, setNewFolder] = useState(false);
  const save = useMutation({
    mutationFn: (folder?: Folder) =>
      AdsApi.save({
        generationId: generation.id,
        conceptId: concept.id,
        name: `${generation.brief.productName} — ${concept.hook.slice(0, 32)}`,
        folderId: folder?.id,
      }),
    onSuccess: (ad, folder) => {
      qc.invalidateQueries({ queryKey: ["ads"] });
      if (folder) qc.invalidateQueries({ queryKey: ["folders"] });
      toast.success(folder ? `Saved to ${folder.name}` : "Saved to My Ads", {
        action: folder
          ? { label: "Open folder", onClick: () => router.push(`/folders/${folder.id}`) }
          : { label: "Open", onClick: () => router.push(`/ads/${ad.id}`) },
      });
    },
    onError: () => toast.error("Couldn't save this concept."),
  });

  const saveAnd = (after: (adId: string) => void) =>
    AdsApi.save({
      generationId: generation.id,
      conceptId: concept.id,
      name: `${generation.brief.productName} — ${concept.hook.slice(0, 32)}`,
    }).then((ad) => {
      qc.invalidateQueries({ queryKey: ["ads"] });
      after(ad.id);
    });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.09 }}
      className="group flex flex-col rounded-lg border border-border bg-card p-4"
    >
      <CreativePreview
        creativeType={concept.creativeType}
        ratio={concept.aspectRatio}
        imageSeed={concept.imageSeed}
        palette={concept.palette}
        hook={concept.hook}
        callToAction={concept.callToAction}
        video={concept.video}
        slides={concept.slides}
        brandName={generation.brief.productName}
        size="md"
        mediaUrl={concept.mediaUrl}
        showRatio={false}
        marks={false}
      />

      <VersionStrip
        className="mt-5"
        versions={versions.map((v) => ({ key: v.id, version: v.version ?? 1, label: v.editInstruction }))}
        current={current}
        onSelect={setCurrent}
      />
      {concept.editInstruction && (
        <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground" title={concept.editInstruction}>
          ↳ {concept.editInstruction}
        </p>
      )}

      {concept.creativeType !== "video" && (
        <RefineBox
          className="mt-4"
          size="sm"
          pending={refine.isPending}
          onRefine={(instruction) => refine.mutateAsync(instruction).catch(() => undefined)}
        />
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-3">
        <div className="flex">
          <Button size="sm" className="rounded-r-none" onClick={() => save.mutate(undefined)} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Save
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="rounded-l-none border-l border-background/25 px-2" disabled={save.isPending} aria-label="Save to a folder">
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-xs">Save to folder</DropdownMenuLabel>
              <FolderMenuItems folders={folders.data ?? []} onPick={(f) => save.mutate(f)} onNew={() => setNewFolder(true)} />
            </DropdownMenuContent>
          </DropdownMenu>
          <NewFolderDialog open={newFolder} onOpenChange={setNewFolder} onCreated={(f) => save.mutate(f)} />
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => saveAnd((adId) => router.push(`/ads/${adId}`))}
        >
          <PenLine className="mr-1.5 h-3.5 w-3.5" /> Edit
        </Button>
        {ANALYZE_ENABLED && (
          <Button
            size="sm"
            variant="ghost"
            className="text-flame hover:bg-flame-soft hover:text-flame"
            onClick={() => saveAnd((adId) => router.push(`/analyze?adId=${adId}&platform=${generation.platform}`))}
          >
            <Flame className="mr-1.5 h-3.5 w-3.5" /> Analyze
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto h-8 w-8 text-muted-foreground hover:text-flame"
          aria-label={`Delete this ${concept.creativeType === "video" ? "video" : "image"}`}
          onClick={() => setToDelete({ generationId: generation.id, conceptId: concept.id, creativeType: concept.creativeType })}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground"
          aria-label="Download"
          onClick={() => toast("Export is coming soon", { description: "Rendered downloads arrive with real generation." })}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
      <DeleteCreationDialog
        target={toDelete}
        onClose={() => setToDelete(null)}
        onDeleted={({ generationDeleted }) => generationDeleted && router.push("/dashboard")}
      />
    </motion.div>
  );
}

export default function GenerationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const generation = useQuery({
    queryKey: ["generation", id],
    queryFn: () => GenerationsApi.get(id),
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 1500 : false),
  });

  const regenerate = useMutation({
    mutationFn: (model: string | undefined) => GenerationsApi.regenerate(id, model),
    onSuccess: (gen) => router.push(`/generations/${gen.id}`),
    onError: (err) => toast.error(apiError(err).message),
  });

  const gen = generation.data;
  const catalog = useCatalog();

  if (generation.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (generation.isError || !gen) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-display text-xl font-bold">Generation not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been deleted, or it belongs to another workspace.
        </p>
        <Button asChild className="mt-6">
          <Link href="/create">Start a new ad</Link>
        </Button>
      </div>
    );
  }

  if (gen.status === "processing") {
    return <GenerationProgress generation={gen} />;
  }

  // The picked model didn't respond (after a retry): nothing was charged — offer the same model again or a working one.
  if (gen.status === "failed") {
    const kind = gen.creativeType === "video" ? "video" : "image";
    const picked = findModel(catalog.models, kind, gen.model);
    const suggested = gen.suggestedModel ? catalog.models[kind].find((m) => m.id === gen.suggestedModel) ?? null : null;
    const price = (m: typeof picked) => modelUnitCost(m, gen.quality, snapDuration(m, gen.durationSeconds)) * (gen.conceptCount || 1);
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-flame-soft text-flame">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold">Couldn't make this {kind}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {gen.error ?? `${picked.name} isn't responding right now.`}
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          {suggested && (
            <Button onClick={() => regenerate.mutate(suggested.id)} disabled={regenerate.isPending}>
              {regenerate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Try with {suggested.name} · ≈ {usd(price(suggested))}
            </Button>
          )}
          <Button variant="outline" onClick={() => regenerate.mutate(undefined)} disabled={regenerate.isPending}>
            Try {picked.name} again · ≈ {usd(price(picked))}
          </Button>
        </div>
        <Link href="/create" className="mt-5 inline-block text-xs text-muted-foreground hover:text-foreground hover:underline">
          Back to Create
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/create"
            className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> New brief
          </Link>
          <h1 className="font-display text-3xl font-bold">Pick your favorites</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <PlatformChip platform={gen.platform} placementLabel={placementLabel(gen.platform, gen.placement)} />
            <Badge variant="outline" className="border-border font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              {gen.creativeType}
            </Badge>
            {gen.model && (
              <Badge variant="outline" className="border-border font-mono text-[9px] tracking-wider text-muted-foreground">
                {findModel(catalog.models, gen.creativeType === "video" ? "video" : "image", gen.model).name}
                {gen.durationSeconds ? ` · ${gen.durationSeconds}s` : ""}
                {gen.estimatedCostUsd ? ` · ≈ ${usd(gen.estimatedCostUsd)}` : ""}
              </Badge>
            )}
            {gen.roastId && (
              <Badge variant="outline" className="border-flame/40 text-[10px] text-flame">
                <Flame className="mr-1 h-3 w-3" /> Built from your analysis
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">{gen.brief.productName}</span>
          </div>
        </div>
        <Button variant="outline" onClick={() => regenerate.mutate(undefined)} disabled={regenerate.isPending}>
          {regenerate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Regenerate all
        </Button>
      </div>

      {gen.error && (
        <div className="mt-6 flex items-start gap-2 rounded-xl border border-honey/40 bg-honey-soft px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-honey" />
          <span>{gen.error}</span>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-5 pb-10 sm:grid-cols-2 xl:grid-cols-4">
        {groupVersions(gen.concepts).map((chain, i) => (
          <ConceptCard key={chain[0].id} versions={chain} generation={gen} index={i} />
        ))}
      </div>

      <div className="mb-6 flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-4 text-xs text-muted-foreground">
        <Copy className="h-3.5 w-3.5" />
        Save the concepts you like — they land in My Ads, where you can edit{ANALYZE_ENABLED ? " or analyze" : ""} them.
      </div>
    </div>
  );
}
