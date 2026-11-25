"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronRight, FolderPlus, Images, Loader2, MoreHorizontal, Plus, Search } from "lucide-react";
import type { Ad } from "@/models";
import { AdsApi } from "@/api/ads.api";
import { apiError } from "@/api/client";
import { childrenOf, pathTo, versionNumber } from "@/lib/folders";
import { FolderDot, NewFolderDialog, useFolders } from "@/components/folders/FolderParts";
import { FolderActionsMenu, FolderTile } from "@/components/folders/FolderTiles";
import { AdCard } from "@/components/shared/AdCard";
import { CreativePreview } from "@/components/creative/CreativePreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Pick saved ads from elsewhere and put them in this folder. */
function AddAdsDialog({ open, onOpenChange, folderId, folderName, ads }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  folderId: string;
  folderName: string;
  ads: Ad[];
}) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const candidates = ads
    .filter((a) => a.folderId !== folderId)
    .filter((a) => !search.trim() || a.name.toLowerCase().includes(search.toLowerCase()) || a.hook.toLowerCase().includes(search.toLowerCase()))
    // Ads not in any folder first.
    .sort((a, b) => Number(!!a.folderId) - Number(!!b.folderId));

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const add = async () => {
    setBusy(true);
    try {
      for (const id of picked) await AdsApi.update(id, { folderId });
      toast.success(`${picked.size} ad${picked.size === 1 ? "" : "s"} added to ${folderName}`);
      setPicked(new Set());
      onOpenChange(false);
    } catch (e) {
      toast.error(apiError(e).message);
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["ads"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setPicked(new Set()); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add ads to {folderName}</DialogTitle>
          <DialogDescription>Ads that are in another folder move here.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search your ads…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="grid max-h-[52vh] grid-cols-3 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-4">
          {candidates.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No other ads to add.</p>}
          {candidates.map((ad) => {
            const on = picked.has(ad.id);
            return (
              <button
                key={ad.id}
                type="button"
                onClick={() => toggle(ad.id)}
                aria-pressed={on}
                className={cn("relative rounded-lg border-2 p-1.5 text-left transition", on ? "border-iris" : "border-transparent hover:border-border")}
              >
                <CreativePreview
                  creativeType={ad.creativeType}
                  ratio={ad.aspectRatio}
                  imageSeed={ad.imageSeed}
                  palette={ad.palette}
                  hook={ad.hook}
                  callToAction={ad.callToAction}
                  video={ad.video}
                  slides={ad.slides}
                  size="sm"
                  showRatio={false}
                  mediaUrl={ad.mediaUrl}
                />
                <p className="mt-1 truncate text-[11px] font-medium">{ad.name}</p>
                {on && (
                  <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-iris text-background">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={add} disabled={picked.size === 0 || busy}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Add {picked.size || ""} ad{picked.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const folders = useFolders();
  const ads = useQuery({ queryKey: ["ads"], queryFn: () => AdsApi.list() });
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sort, setSort] = useState<"version" | "newest">("version");

  const all = folders.data ?? [];
  const folder = all.find((f) => f.id === id);
  const path = folder ? pathTo(all, folder.id) : [];
  const subfolders = childrenOf(all, id);

  const inFolder = useMemo(() => {
    const list = (ads.data ?? []).filter((a) => a.folderId === id);
    if (sort === "newest") return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // By version: v1, v2, … first, then other labels, then unlabelled; newest first within each.
    return [...list].sort((a, b) => {
      const va = versionNumber(a.versionTag), vb = versionNumber(b.versionTag);
      const rank = (v: number | null, t?: string | null) => (v !== null ? 0 : t ? 1 : 2);
      return rank(va, a.versionTag) - rank(vb, b.versionTag) || (va ?? 0) - (vb ?? 0) || b.createdAt.localeCompare(a.createdAt);
    });
  }, [ads.data, id, sort]);
  const nextVersion = Math.max(0, ...inFolder.map((a) => versionNumber(a.versionTag) ?? 0)) + 1;

  if (folders.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-64" />
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="aspect-[4/5] rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (!folder) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-display text-xl font-bold">Folder not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">It may have been deleted.</p>
        <Button asChild className="mt-6" variant="outline"><Link href="/folders">All folders</Link></Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      {/* Breadcrumbs */}
      <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Link href="/folders" className="hover:text-foreground">Folders</Link>
        {path.map((f) => (
          <span key={f.id} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            {f.id === id ? <span className="text-foreground">{f.name}</span> : <Link href={`/folders/${f.id}`} className="hover:text-foreground">{f.name}</Link>}
          </span>
        ))}
      </nav>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <FolderDot color={folder.color} className="h-4 w-4" />
          <h1 className="truncate font-display text-3xl font-bold">{folder.name}</h1>
          <FolderActionsMenu
            folder={folder}
            folders={all}
            onDeleted={() => router.replace(folder.parentId ? `/folders/${folder.parentId}` : "/folders")}
            trigger={
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label="Folder actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            }
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setCreating(true)}>
            <FolderPlus className="mr-1.5 h-4 w-4" /> New folder
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add ads
          </Button>
        </div>
      </div>

      {subfolders.length > 0 && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {subfolders.map((f) => <FolderTile key={f.id} folder={f} folders={all} />)}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {inFolder.length} ad{inFolder.length === 1 ? "" : "s"}
          {inFolder.length > 0 && " · tap the version label on a card to set v1, v2…"}
        </p>
        {inFolder.length > 1 && (
          <Select value={sort} onValueChange={(v) => setSort(v as "version" | "newest")}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="version">By version</SelectItem>
              <SelectItem value="newest">Newest first</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {ads.isLoading ? (
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="aspect-[4/5] rounded-lg" />)}
        </div>
      ) : inFolder.length === 0 ? (
        <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
            <Images className="h-5 w-5 text-muted-foreground" />
          </div>
          <h3 className="mb-1 font-display text-lg font-semibold">No ads in here yet</h3>
          <p className="mb-5 max-w-sm text-sm text-muted-foreground">Add ads you've saved, or create one and pick “Save to folder”.</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setAdding(true)}><Plus className="mr-1.5 h-4 w-4" /> Add ads</Button>
            <Button asChild><Link href="/create">Create an ad</Link></Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 pb-10 md:grid-cols-3 xl:grid-cols-4">
          {inFolder.map((ad) => <AdCard key={ad.id} ad={ad} versionPicker={{ nextVersion }} />)}
        </div>
      )}

      <NewFolderDialog open={creating} onOpenChange={setCreating} parentId={folder.id} />
      <AddAdsDialog open={adding} onOpenChange={setAdding} folderId={folder.id} folderName={folder.name} ads={ads.data ?? []} />
    </div>
  );
}
