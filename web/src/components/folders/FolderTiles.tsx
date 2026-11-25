"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpToLine, Folder as FolderIcon, FolderInput, FolderPlus, Loader2, MoreHorizontal, Palette, PenLine, Trash2 } from "lucide-react";
import type { Folder, FolderColor } from "@/models";
import { FoldersApi } from "@/api/folders.api";
import { apiError } from "@/api/client";
import { FOLDER_COLORS, FOLDER_COLOR_IDS, branchOf, childrenOf, totalAds } from "@/lib/folders";
import { FolderDot, FolderMenuItems, NewFolderDialog } from "@/components/folders/FolderParts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function useUpdateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; color?: FolderColor; parentId?: string } }) => FoldersApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["folders"] }),
    onError: (e) => toast.error(apiError(e).message),
  });
}

function RenameFolderDialog({ folder, open, onOpenChange }: { folder: Folder; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState(folder.name);
  useEffect(() => { if (open) setName(folder.name); }, [open, folder.name]);
  const update = useUpdateFolder();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) update.mutate({ id: folder.id, body: { name: name.trim() } }, { onSuccess: () => onOpenChange(false) });
          }}
        >
          <DialogHeader><DialogTitle>Rename folder</DialogTitle></DialogHeader>
          <Input autoFocus className="mt-4" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || update.isPending}>
              {update.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** ⋯ menu for a folder: new subfolder, rename, colour, move, delete. */
export function FolderActionsMenu({
  folder,
  folders,
  onDeleted,
  trigger,
}: {
  folder: Folder;
  folders: Folder[];
  onDeleted?: () => void;
  trigger?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const update = useUpdateFolder();
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const branch = branchOf(folders, folder.id);
  const subfolders = branch.size - 1;
  const ads = totalAds(folders, folder.id);

  const remove = useMutation({
    mutationFn: () => FoldersApi.remove(folder.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["ads"] });
      toast.success(`Folder "${folder.name}" deleted`);
      onDeleted?.();
    },
    onError: (e) => toast.error(apiError(e).message),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {trigger ?? (
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" aria-label={`${folder.name} actions`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setCreating(true)}>
            <FolderPlus className="mr-2 h-4 w-4" /> New folder inside
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <PenLine className="mr-2 h-4 w-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><Palette className="mr-2 h-4 w-4" /> Colour</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {FOLDER_COLOR_IDS.map((c) => (
                <DropdownMenuItem key={c} onClick={() => update.mutate({ id: folder.id, body: { color: c } })} className="capitalize">
                  <span className="mr-2 h-3 w-3 rounded-full" style={{ background: FOLDER_COLORS[c] }} /> {c}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><FolderInput className="mr-2 h-4 w-4" /> Move to</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {folder.parentId && (
                <>
                  <DropdownMenuItem onClick={() => update.mutate({ id: folder.id, body: { parentId: "" } })}>
                    <ArrowUpToLine className="mr-2 h-4 w-4" /> Top level
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <FolderMenuItems
                folders={folders}
                currentId={folder.parentId}
                disabledIds={branch}
                onPick={(target) => target.id !== folder.parentId && update.mutate({ id: folder.id, body: { parentId: target.id } }, { onSuccess: () => toast.success(`Moved into ${target.name}`) })}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleting(true)}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameFolderDialog folder={folder} open={renaming} onOpenChange={setRenaming} />
      <NewFolderDialog open={creating} onOpenChange={setCreating} parentId={folder.id} onCreated={(f) => router.push(`/folders/${f.id}`)} />
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{folder.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {subfolders > 0 ? `Its ${subfolders} subfolder${subfolders === 1 ? "" : "s"} go too. ` : ""}
              {ads > 0 ? `The ${ads} ad${ads === 1 ? "" : "s"} inside stay in My Ads — only the folder goes.` : "No ads are deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A folder card in a grid: colour, name, how many ads and subfolders. */
export function FolderTile({ folder, folders }: { folder: Folder; folders: Folder[] }) {
  const subs = childrenOf(folders, folder.id).length;
  const ads = totalAds(folders, folder.id);
  return (
    <div className="group relative flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-muted-foreground/40">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: `${FOLDER_COLORS[folder.color]}22` }}>
        <FolderIcon className="h-5 w-5" style={{ color: FOLDER_COLORS[folder.color] }} fill={`${FOLDER_COLORS[folder.color]}55`} />
      </div>
      <Link href={`/folders/${folder.id}`} className="min-w-0 flex-1 after:absolute after:inset-0">
        <p className="truncate text-sm font-semibold">{folder.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {ads} ad{ads === 1 ? "" : "s"}
          {subs > 0 && ` · ${subs} folder${subs === 1 ? "" : "s"}`}
        </p>
      </Link>
      <div className="relative z-10">
        <FolderActionsMenu folder={folder} folders={folders} />
      </div>
    </div>
  );
}

export { FolderDot };
