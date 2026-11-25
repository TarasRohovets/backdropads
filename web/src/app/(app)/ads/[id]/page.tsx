"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Copy,
  FolderInput,
  FolderMinus,
  Flame,
  Image as ImageIcon,
  Layers,
  Loader2,
  MousePointerClick,
  Save,
  Type,
} from "lucide-react";
import { AdsApi } from "@/api/ads.api";
import { apiError } from "@/api/client";
import { placementLabel } from "@/lib/taxonomy";
import { CreativePreview } from "@/components/creative/CreativePreview";
import { RefineBox, VersionStrip } from "@/components/creative/RefineBox";
import { PlatformChip } from "@/components/shared/PlatformChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ANALYZE_ENABLED } from "@/lib/features";
import { cn } from "@/lib/utils";
import { FolderDot, FolderMenuItems, NewFolderDialog, VersionTagPicker, useFolders, useMoveAd } from "@/components/folders/FolderParts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { versionNumber } from "@/lib/folders";

const SWATCHES = [
  ["#1A1A22", "#101014"],
  ["#E8422A", "#1C0E0A"],
  ["#D98A18", "#201505"],
  ["#1E9E6A", "#07160F"],
  ["#4FA3FF", "#0A1220"],
  ["#F45CA2", "#1D0A14"],
];

type LayerKey = "hook" | "primaryText" | "cta" | "image";

const LAYERS: { key: LayerKey; label: string; icon: React.ElementType }[] = [
  { key: "hook", label: "Headline", icon: Type },
  { key: "primaryText", label: "Primary text", icon: Type },
  { key: "cta", label: "CTA button", icon: MousePointerClick },
  { key: "image", label: "Background image", icon: ImageIcon },
];

export default function AdEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();

  const adQuery = useQuery({ queryKey: ["ad", id], queryFn: () => AdsApi.get(id) });
  const ad = adQuery.data;
  const folders = useFolders();
  const allAds = useQuery({ queryKey: ["ads"], queryFn: () => AdsApi.list() });
  const move = useMoveAd();
  const [newFolder, setNewFolder] = useState(false);
  const folder = ad?.folderId ? folders.data?.find((f) => f.id === ad.folderId) : undefined;
  const nextVersion =
    Math.max(0, ...(allAds.data ?? []).filter((a) => a.folderId && a.folderId === ad?.folderId).map((a) => versionNumber(a.versionTag) ?? 0)) + 1;

  const [name, setName] = useState("");
  const [hook, setHook] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [cta, setCta] = useState("");
  const [palette, setPalette] = useState<string[]>(SWATCHES[0]);
  const [ready, setReady] = useState(true);
  const [activeLayer, setActiveLayer] = useState<LayerKey>("hook");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!ad) return;
    setName(ad.name);
    setHook(ad.hook);
    setPrimaryText(ad.primaryText);
    setCta(ad.callToAction);
    setPalette(ad.palette?.length ? ad.palette : SWATCHES[0]);
    setReady(ad.status === "ready");
    setDirty(false);
  }, [ad]);

  const mark = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () =>
      AdsApi.update(id, {
        name,
        hook,
        primaryText,
        callToAction: cta,
        palette,
        status: ready ? "ready" : "draft",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ads"] });
      qc.invalidateQueries({ queryKey: ["ad", id] });
      setDirty(false);
      toast.success("Changes saved");
    },
    onError: () => toast.error("Couldn't save. Is the API running?"),
  });

  // Refine loop: instruction → new current version; history kept in ad.versions.
  const refine = useMutation({
    mutationFn: (instruction: string) => AdsApi.refine(id, instruction),
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: ["ad", id] });
      qc.invalidateQueries({ queryKey: ["ads"] });
      toast.success(`Version ${next.currentVersion} ready`);
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const restore = useMutation({
    mutationFn: (version: number) => AdsApi.restoreVersion(id, version),
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: ["ad", id] });
      qc.invalidateQueries({ queryKey: ["ads"] });
      toast.success(`Showing version ${next.currentVersion}`);
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  if (adQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (adQuery.isError || !ad) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-display text-xl font-bold">Ad not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">It may have been deleted, or the API isn't running.</p>
        <Button asChild className="mt-6" variant="outline">
          <Link href="/ads">Back to My Ads</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      {/* Editor toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-3 sm:px-6">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label="Back to My Ads">
          <Link href="/ads"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <Input
          value={name}
          onChange={(e) => mark(setName)(e.target.value)}
          className="h-8 w-56 border-transparent bg-transparent font-semibold hover:border-border focus:border-input"
          aria-label="Ad name"
        />
        <PlatformChip platform={ad.platform} placementLabel={placementLabel(ad.platform, ad.placement)} />
        <Badge variant="outline" className="border-border font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          {ad.creativeType} · {ad.aspectRatio}
        </Badge>
        <VersionTagPicker ad={ad} nextVersion={nextVersion} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              {folder ? <FolderDot color={folder.color} /> : <FolderInput className="h-3.5 w-3.5" />}
              <span className="max-w-[10rem] truncate">{folder ? folder.name : "Save to folder"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <FolderMenuItems
              folders={folders.data ?? []}
              currentId={ad.folderId}
              onPick={(f) => f.id !== ad.folderId && move.mutate({ ad, folderId: f.id, folderName: f.name })}
              onNew={() => setNewFolder(true)}
            />
            {folder && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push(`/folders/${folder.id}`)}>
                  <FolderInput className="mr-2 h-4 w-4" /> Open {folder.name}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => move.mutate({ ad, folderId: null })}>
                  <FolderMinus className="mr-2 h-4 w-4" /> Remove from folder
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <NewFolderDialog open={newFolder} onOpenChange={setNewFolder} onCreated={(f) => move.mutate({ ad, folderId: f.id, folderName: f.name })} />
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={ready} onCheckedChange={mark(setReady)} aria-label="Ready status" />
            {ready ? "Ready" : "Draft"}
          </label>
          {ANALYZE_ENABLED && (
            <Button
              variant="outline"
              size="sm"
              className="border-flame/40 text-flame hover:bg-flame-soft hover:text-flame"
              onClick={() => router.push(`/analyze?adId=${ad.id}&platform=${ad.platform}`)}
            >
              <Flame className="mr-1.5 h-3.5 w-3.5" /> Analyze
            </Button>
          )}
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Save
          </Button>
        </div>
      </div>

      {/* Three panes: layers / canvas / properties */}
      <div className="grid flex-1 lg:grid-cols-[220px_1fr_300px]">
        {/* Layers */}
        <aside className="hidden border-r border-border bg-card/40 p-4 lg:block">
          <p className="eyebrow mb-3 flex items-center gap-1.5">
            <Layers className="h-3 w-3" /> Layers
          </p>
          <div className="space-y-1">
            {LAYERS.map((l) => {
              const Icon = l.icon;
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setActiveLayer(l.key)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors",
                    activeLayer === l.key
                      ? "bg-iris-soft text-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5", activeLayer === l.key && "text-iris")} />
                  {l.label}
                </button>
              );
            })}
          </div>
          <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground/70">
            Full layout controls arrive with real rendering. Text, CTA and colors are editable now.
          </p>
        </aside>

        {/* Canvas */}
        <div className="flex items-center justify-center bg-canvas p-8 sm:p-12">
          <div className="w-full max-w-sm">
            <CreativePreview
              creativeType={ad.creativeType}
              ratio={ad.aspectRatio}
              imageSeed={ad.imageSeed}
              palette={palette}
              hook={hook}
              callToAction={cta}
              video={ad.video}
              slides={ad.slides}
              brandName={ad.name}
              size="lg"
              mediaUrl={ad.mediaUrl}
            />

            {ad.creativeType !== "video" && (
              <div className="mt-8 space-y-3">
                <VersionStrip
                  versions={(ad.versions ?? []).map((v) => ({ key: v.id, version: v.version, label: v.editInstruction }))}
                  current={ad.currentVersion ?? 1}
                  onSelect={(v) => restore.mutate(v)}
                />
                <RefineBox
                  pending={refine.isPending || restore.isPending}
                  onRefine={(instruction) => refine.mutateAsync(instruction).catch(() => undefined)}
                />
                {ad.model && ad.model !== "mock" && (
                  <p className="font-mono text-[10px] text-muted-foreground">generated by {ad.model}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Properties */}
        <aside className="border-t border-border bg-card/40 p-5 lg:border-l lg:border-t-0">
          <p className="eyebrow mb-4">Properties</p>
          <div className="space-y-4">
            <div>
              <Label htmlFor="hook" className="text-xs">Headline / hook</Label>
              <Textarea
                id="hook"
                className="mt-1.5 min-h-16 text-sm"
                value={hook}
                onChange={(e) => mark(setHook)(e.target.value)}
                onFocus={() => setActiveLayer("hook")}
              />
            </div>
            <div>
              <Label htmlFor="primary" className="text-xs">Primary text</Label>
              <Textarea
                id="primary"
                className="mt-1.5 min-h-20 text-sm"
                value={primaryText}
                onChange={(e) => mark(setPrimaryText)(e.target.value)}
                onFocus={() => setActiveLayer("primaryText")}
              />
            </div>
            <div>
              <Label htmlFor="cta" className="text-xs">Call to action</Label>
              <Input
                id="cta"
                className="mt-1.5"
                value={cta}
                onChange={(e) => mark(setCta)(e.target.value)}
                onFocus={() => setActiveLayer("cta")}
              />
            </div>
            <div>
              <Label className="text-xs">Palette</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {SWATCHES.map((sw) => {
                  const selected = palette[0] === sw[0];
                  return (
                    <button
                      key={sw[0]}
                      type="button"
                      aria-label={`Palette ${sw[0]}`}
                      onClick={() => mark(setPalette)(sw)}
                      className={cn(
                        "h-8 w-8 rounded-full border-2 transition-transform hover:scale-110",
                        selected ? "border-foreground" : "border-transparent"
                      )}
                      style={{ background: `linear-gradient(135deg, ${sw[0]} 50%, ${sw[1]} 50%)` }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Spec</p>
              <dl className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                <div className="flex justify-between"><dt>Ratio</dt><dd className="font-mono">{ad.aspectRatio}</dd></div>
                <div className="flex justify-between"><dt>Type</dt><dd className="capitalize">{ad.creativeType}</dd></div>
                {ad.video && <div className="flex justify-between"><dt>Duration</dt><dd className="font-mono">0:{String(ad.video.durationSeconds).padStart(2, "0")}</dd></div>}
                {ad.slides && <div className="flex justify-between"><dt>Slides</dt><dd className="font-mono">{ad.slides.length}</dd></div>}
              </dl>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() =>
                AdsApi.duplicate(ad.id).then((copy) => {
                  qc.invalidateQueries({ queryKey: ["ads"] });
                  toast.success("Duplicated");
                  router.push(`/ads/${copy.id}`);
                })
              }
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Duplicate ad
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
