import type { Folder, FolderColor } from "@/models";

/** Folder dot colours (match the API's FolderColors). */
export const FOLDER_COLORS: Record<FolderColor, string> = {
  violet: "#8B5CF6",
  pink: "#F45CA2",
  lime: "#A3E635",
  sky: "#4FA3FF",
  honey: "#F5B53D",
  mint: "#2DD4A0",
};
export const FOLDER_COLOR_IDS = Object.keys(FOLDER_COLORS) as FolderColor[];

export const childrenOf = (folders: Folder[], parentId: string | null | undefined) =>
  folders.filter((f) => (f.parentId ?? null) === (parentId ?? null));

/** Top → this folder, for breadcrumbs. */
export function pathTo(folders: Folder[], id: string): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  for (let cur = byId.get(id); cur && path.length < 50; cur = cur.parentId ? byId.get(cur.parentId) : undefined) path.unshift(cur);
  return path;
}

/** The folder and everything inside it. */
export function branchOf(folders: Folder[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}

/** Depth-first order with each folder's level, for indented pickers and the sidebar tree. */
export function flattenTree(folders: Folder[], parentId: string | null = null, depth = 0): { folder: Folder; depth: number }[] {
  if (depth > 20) return [];
  return childrenOf(folders, parentId).flatMap((folder) => [{ folder, depth }, ...flattenTree(folders, folder.id, depth + 1)]);
}

/** Ads in this folder and all its subfolders. */
export const totalAds = (folders: Folder[], id: string) => {
  const branch = branchOf(folders, id);
  return folders.filter((f) => branch.has(f.id)).reduce((n, f) => n + f.adCount, 0);
};

/** "v3" → 3; anything else → null. */
export const versionNumber = (tag?: string | null) => {
  const m = tag?.match(/^v(\d+)$/i);
  return m ? Number(m[1]) : null;
};
