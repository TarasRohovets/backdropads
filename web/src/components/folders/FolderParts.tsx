"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FolderInput, FolderMinus, FolderPlus, Loader2, Tag, X } from "lucide-react";
import type { Ad, Folder, FolderColor } from "@/models";
import { FoldersApi } from "@/api/folders.api";
import { AdsApi } from "@/api/ads.api";
import { apiError } from "@/api/client";
import { FOLDER_COLORS, FOLDER_COLOR_IDS, flattenTree, pathTo, versionNumber } from "@/lib/folders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const useFolders = () => useQuery({ queryKey: ["folders"], queryFn: () => FoldersApi.list(), staleTime: 30_000 });

export function FolderDot({ color, className }: { color: FolderColor; className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)} style={{ background: FOLDER_COLORS[color] ?? FOLDER_COLORS.violet }} aria-hidden />;
}

/** Create a folder (at the top level, or inside `parentId`). */
export function NewFolderDialog({
  open,
  onOpenChange,
  parentId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId?: string | null;
  onCreated?: (folder: Folder) => void;
}) {
  const qc = useQueryClient();
  const folders = useFolders();
  const [name, setName] = useState("");
  const [color, setColor] = useState<FolderColor | null>(null);
  useEffect(() => {
    if (open) { setName(""); setColor(null); }
  }, [open]);
  const parent = parentId ? folders.data?.find((f) => f.id === parentId) : undefined;

  const create = useMutation({
    mutationFn: () => FoldersApi.create({ name: name.trim(), parentId, color: color ?? undefined }),
    onSuccess: (folder) => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      toast.success(`Folder "${folder.name}" created`);
      onOpenChange(false);
      onCreated?.(folder);
    },
    onError: (e) => toast.error(apiError(e).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              {parent ? <>Inside <span className="font-semibold text-foreground">{pathTo(folders.data ?? [], parent.id).map((f) => f.name).join(" / ")}</span>.</> : "Group ads by channel, campaign, client — whatever helps."}
            </DialogDescription>
          </DialogHeader>
          <Input autoFocus className="mt-4" placeholder="e.g. Black Friday campaign" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="mt-4 flex items-center gap-2" role="radiogroup" aria-label="Folder colour">
            {FOLDER_COLOR_IDS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn("flex h-7 w-7 items-center justify-center rounded-full border-2 transition", color === c ? "border-foreground" : "border-transparent hover:border-border")}
              >
                <span className="h-4 w-4 rounded-full" style={{ background: FOLDER_COLORS[c] }} />
              </button>
            ))}
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Create folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The folder tree as menu items (indented), for any dropdown that picks a folder. */
export function FolderMenuItems({
  folders,
  currentId,
  onPick,
  onNew,
  disabledIds,
}: {
  folders: Folder[];
  currentId?: string | null;
  onPick: (folder: Folder) => void;
  onNew?: () => void;
  disabledIds?: Set<string>;
}) {
  const rows = flattenTree(folders);
  return (
    <>
      <div className="max-h-72 overflow-y-auto">
        {rows.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No folders yet</p>}
        {rows.map(({ folder, depth }) => (
          <DropdownMenuItem
            key={folder.id}
            disabled={disabledIds?.has(folder.id)}
            onClick={() => onPick(folder)}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <FolderDot color={folder.color} className="mr-2" />
            <span className="truncate">{folder.name}</span>
            {folder.id === currentId && <Check className="ml-auto h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </div>
      {onNew && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onNew}>
            <FolderPlus className="mr-2 h-4 w-4" /> New folder…
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

/** Put an ad in a folder (or take it out). */
export function useMoveAd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ad, folderId }: { ad: Ad; folderId: string | null; folderName?: string }) =>
      AdsApi.update(ad.id, { folderId: folderId ?? "" }),
    onSuccess: (updated, { folderName }) => {
      qc.invalidateQueries({ queryKey: ["ads"] });
      qc.invalidateQueries({ queryKey: ["ad", updated.id] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      toast.success(folderName ? `Saved to ${folderName}` : "Removed from the folder");
    },
    onError: (e) => toast.error(apiError(e).message),
  });
}

/** "Save to folder" submenu for an ad's ⋯ menu. Creating a folder from here saves the ad into it. */
export function MoveToFolderSub({ ad, onNewFolder }: { ad: Ad; onNewFolder: () => void }) {
  const folders = useFolders();
  const move = useMoveAd();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderInput className="mr-2 h-4 w-4" /> {ad.folderId ? "Move to folder" : "Save to folder"}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        <FolderMenuItems
          folders={folders.data ?? []}
          currentId={ad.folderId}
          onPick={(f) => f.id !== ad.folderId && move.mutate({ ad, folderId: f.id, folderName: f.name })}
          onNew={onNewFolder}
        />
        {ad.folderId && (
          <DropdownMenuItem onClick={() => move.mutate({ ad, folderId: null })}>
            <FolderMinus className="mr-2 h-4 w-4" /> Remove from folder
          </DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** The version label on an ad card ("v2"); click to change it. `nextVersion` suggests the next free number. */
export function VersionTagPicker({ ad, nextVersion, className }: { ad: Ad; nextVersion?: number; className?: string }) {
  const qc = useQueryClient();
  const [custom, setCustom] = useState("");
  const [open, setOpen] = useState(false);
  const set = useMutation({
    mutationFn: (versionTag: string) => { setOpen(false); return AdsApi.update(ad.id, { versionTag }); },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["ads"] });
      qc.invalidateQueries({ queryKey: ["ad", updated.id] });
    },
    onError: (e) => toast.error(apiError(e).message),
  });
  const current = versionNumber(ad.versionTag);
  const numbers = Array.from({ length: Math.max(6, (nextVersion ?? 1) + 1, (current ?? 0) + 1) }, (_, i) => i + 1).slice(0, 12);

  return (
    <DropdownMenu open={open} onOpenChange={(o) => { setOpen(o); if (o) setCustom(""); }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ad.versionTag ? `Version ${ad.versionTag}, change` : "Set a version"}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full px-2 font-mono text-[11px] font-bold transition",
            ad.versionTag
              ? "bg-foreground text-background hover:opacity-85"
              : "border border-dashed border-foreground/40 bg-background/85 text-foreground/80 backdrop-blur hover:border-foreground hover:text-foreground",
            className
          )}
        >
          {set.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : !ad.versionTag && <Tag className="h-3 w-3" />}
          {ad.versionTag ?? "Version"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-xs">Version</DropdownMenuLabel>
        <div className="grid grid-cols-4 gap-1 px-1.5 pb-1.5">
          {numbers.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => set.mutate(`v${n}`)}
              className={cn(
                "rounded-md py-1.5 font-mono text-xs font-semibold transition",
                current === n ? "bg-foreground text-background" : "bg-secondary hover:bg-accent",
                n === nextVersion && current !== n && "ring-1 ring-iris"
              )}
            >
              v{n}
            </button>
          ))}
        </div>
        <form
          className="flex gap-1 px-1.5 pb-1.5"
          onSubmit={(e) => { e.preventDefault(); if (custom.trim()) set.mutate(custom.trim()); }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={12} placeholder="Custom, e.g. final" className="h-7 text-xs" />
          <Button type="submit" size="sm" variant="secondary" className="h-7 px-2 text-xs" disabled={!custom.trim()}>Set</Button>
        </form>
        {ad.versionTag && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => set.mutate("")}>
              <X className="mr-2 h-4 w-4" /> Clear version
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
