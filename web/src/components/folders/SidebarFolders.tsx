"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import type { Folder } from "@/models";
import { childrenOf, pathTo, totalAds } from "@/lib/folders";
import { FolderDot, NewFolderDialog, useFolders } from "@/components/folders/FolderParts";
import { cn } from "@/lib/utils";

/** The sidebar's Folders section: the folder tree (subfolders fold open), plus "+" to create one. */
export function SidebarFolders({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const router = useRouter();
  const folders = useFolders();
  const all = folders.data ?? [];
  const activeId = pathname.startsWith("/folders/") ? pathname.split("/")[2] : null;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  // Open the way down to the folder being viewed (and the folder itself, to show its subfolders).
  useEffect(() => {
    if (!activeId || all.length === 0) return;
    const ancestors = pathTo(all, activeId).map((f) => f.id);
    if (ancestors.some((id) => !open.has(id))) setOpen((o) => new Set([...o, ...ancestors]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, all.length]);

  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const renderRow = (folder: Folder, depth: number): React.ReactNode => {
    const kids = childrenOf(all, folder.id);
    const expanded = open.has(folder.id);
    const active = folder.id === activeId;
    const count = totalAds(all, folder.id);
    return (
      <Fragment key={folder.id}>
        <div
          className={cn(
            "group flex items-center rounded-md pr-2 text-sm transition-colors",
            active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          )}
          style={{ paddingLeft: 4 + depth * 12 }}
        >
          <button
            type="button"
            onClick={() => toggle(folder.id)}
            className={cn("flex h-7 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground", kids.length === 0 && "invisible")}
            aria-label={expanded ? `Fold ${folder.name}` : `Open ${folder.name}`}
            aria-expanded={expanded}
            tabIndex={kids.length === 0 ? -1 : 0}
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
          </button>
          <Link href={`/folders/${folder.id}`} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 font-medium">
            <FolderDot color={folder.color} />
            <span className="truncate">{folder.name}</span>
            {count > 0 && <span className="ml-auto pl-1 font-mono text-[10px] text-muted-foreground">{count}</span>}
          </Link>
        </div>
        {expanded && kids.map((k) => renderRow(k, depth + 1))}
      </Fragment>
    );
  };

  return (
    <div className="space-y-0.5">
      <div className="mb-2 flex items-center justify-between px-3">
        <Link href="/folders" onClick={onNavigate} className={cn("eyebrow hover:text-foreground", pathname === "/folders" && "text-foreground")}>
          Folders
        </Link>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          aria-label="New folder"
          title="New folder"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {childrenOf(all, null).map((f) => renderRow(f, 0))}
      <NewFolderDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(f) => { onNavigate?.(); router.push(`/folders/${f.id}`); }}
      />
    </div>
  );
}
