"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal, Copy, Flame, PenLine, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Ad } from "@/models";
import { AdsApi } from "@/api/ads.api";
import { placementLabel, scoreTone } from "@/lib/taxonomy";
import { CreativePreview } from "@/components/creative/CreativePreview";
import { PlatformChip } from "@/components/shared/PlatformChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ANALYZE_ENABLED } from "@/lib/features";
import { FolderDot, MoveToFolderSub, NewFolderDialog, VersionTagPicker, useFolders, useMoveAd } from "@/components/folders/FolderParts";

const TONE_TEXT: Record<string, string> = {
  mint: "text-mint",
  honey: "text-honey",
  flame: "text-flame",
};

/**
 * A saved ad. `versionPicker` (inside a folder) makes the version label editable on the card; elsewhere it shows
 * as a badge. `showFolder` adds the folder's name (My Ads).
 */
export function AdCard({ ad, versionPicker, showFolder }: { ad: Ad; versionPicker?: { nextVersion: number }; showFolder?: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [newFolder, setNewFolder] = useState(false);
  const move = useMoveAd();
  const folders = useFolders();
  const folder = showFolder && ad.folderId ? folders.data?.find((f) => f.id === ad.folderId) : undefined;

  const duplicate = useMutation({
    mutationFn: () => AdsApi.duplicate(ad.id),
    onSuccess: (copy) => {
      qc.invalidateQueries({ queryKey: ["ads"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      toast.success(`Duplicated as "${copy.name}"`);
    },
  });

  const remove = useMutation({
    mutationFn: () => AdsApi.remove(ad.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ads"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      toast.success("Ad deleted");
    },
  });

  return (
    <div className="group relative rounded-lg border border-border bg-card p-3 transition-colors hover:border-muted-foreground/30">
      {/* Version label: editable inside a folder, a badge everywhere else */}
      {(versionPicker || ad.versionTag) && (
        <div className="absolute left-5 top-5 z-10">
          {versionPicker ? (
            <VersionTagPicker ad={ad} nextVersion={versionPicker.nextVersion} className="shadow-md" />
          ) : (
            <span className="inline-flex h-6 items-center rounded-full bg-foreground px-2 font-mono text-[11px] font-bold text-background shadow-md">
              {ad.versionTag}
            </span>
          )}
        </div>
      )}
      <Link href={`/ads/${ad.id}`} className="block" aria-label={`Open ${ad.name}`}>
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
      </Link>

      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/ads/${ad.id}`} className="block truncate text-sm font-semibold hover:underline">
            {ad.name}
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <PlatformChip platform={ad.platform} placementLabel={placementLabel(ad.platform, ad.placement)} />
            <Badge variant="outline" className="border-border font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              {ad.creativeType}
            </Badge>
            {folder && (
              <Link href={`/folders/${folder.id}`} className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                <FolderDot color={folder.color} className="h-2 w-2" /> {folder.name}
              </Link>
            )}
            {ad.status === "draft" && (
              <Badge variant="outline" className="border-honey/40 text-[10px] text-honey">
                Draft
              </Badge>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" aria-label="Ad actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => router.push(`/ads/${ad.id}`)}>
              <PenLine className="mr-2 h-4 w-4" /> Open in editor
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => duplicate.mutate()}>
              <Copy className="mr-2 h-4 w-4" /> Duplicate
            </DropdownMenuItem>
            <MoveToFolderSub ad={ad} onNewFolder={() => setNewFolder(true)} />
            {ANALYZE_ENABLED && (
              <DropdownMenuItem onClick={() => router.push(`/analyze?adId=${ad.id}&platform=${ad.platform}`)}>
                <Flame className="mr-2 h-4 w-4 text-flame" /> Analyze this ad
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => remove.mutate()}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <NewFolderDialog
          open={newFolder}
          onOpenChange={setNewFolder}
          onCreated={(f) => move.mutate({ ad, folderId: f.id, folderName: f.name })}
        />
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {formatDistanceToNow(new Date(ad.createdAt), { addSuffix: true })}
        </span>
        {ANALYZE_ENABLED && typeof ad.score === "number" && (
          <span className={`font-mono text-[11px] font-semibold ${TONE_TEXT[scoreTone(ad.score)]}`}>
            {ad.score}
          </span>
        )}
      </div>
    </div>
  );
}
