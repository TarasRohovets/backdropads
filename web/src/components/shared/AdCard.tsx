"use client";

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

const TONE_TEXT: Record<string, string> = {
  mint: "text-mint",
  honey: "text-honey",
  flame: "text-flame",
};

export function AdCard({ ad }: { ad: Ad }) {
  const router = useRouter();
  const qc = useQueryClient();

  const duplicate = useMutation({
    mutationFn: () => AdsApi.duplicate(ad.id),
    onSuccess: (copy) => {
      qc.invalidateQueries({ queryKey: ["ads"] });
      toast.success(`Duplicated as "${copy.name}"`);
    },
  });

  const remove = useMutation({
    mutationFn: () => AdsApi.remove(ad.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ads"] });
      toast.success("Ad deleted");
    },
  });

  return (
    <div className="group relative rounded-lg border border-border bg-card p-3 transition-colors hover:border-muted-foreground/30">
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
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => router.push(`/ads/${ad.id}`)}>
              <PenLine className="mr-2 h-4 w-4" /> Open in editor
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => duplicate.mutate()}>
              <Copy className="mr-2 h-4 w-4" /> Duplicate
            </DropdownMenuItem>
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
