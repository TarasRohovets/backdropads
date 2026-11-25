"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FolderPlus, Folders, Images } from "lucide-react";
import { AdsApi } from "@/api/ads.api";
import { childrenOf } from "@/lib/folders";
import { NewFolderDialog, useFolders } from "@/components/folders/FolderParts";
import { FolderTile } from "@/components/folders/FolderTiles";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function FoldersPage() {
  const router = useRouter();
  const folders = useFolders();
  const ads = useQuery({ queryKey: ["ads"], queryFn: () => AdsApi.list() });
  const [creating, setCreating] = useState(false);
  const top = childrenOf(folders.data ?? [], null);
  const unfiled = ads.data?.filter((a) => !a.folderId).length ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Library</p>
          <h1 className="font-display text-3xl font-bold">Folders</h1>
          <p className="mt-1 text-sm text-muted-foreground">Keep ads together by channel or campaign, and number their versions.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <FolderPlus className="mr-1.5 h-4 w-4" /> New folder
        </Button>
      </div>

      {folders.isLoading ? (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[78px] rounded-lg" />)}
        </div>
      ) : top.length === 0 ? (
        <EmptyState className="mt-8" icon={Folders} title="No folders yet" description="Create one, then save ads into it from any ad's ⋯ menu." />
      ) : (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {top.map((f) => <FolderTile key={f.id} folder={f} folders={folders.data!} />)}
        </div>
      )}

      {unfiled > 0 && (
        <Link href="/ads" className="mt-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <Images className="h-4 w-4" /> {unfiled} ad{unfiled === 1 ? "" : "s"} not in a folder yet — open My Ads to file them
        </Link>
      )}

      <NewFolderDialog open={creating} onOpenChange={setCreating} onCreated={(f) => router.push(`/folders/${f.id}`)} />
    </div>
  );
}
