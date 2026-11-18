"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { UploadsApi, isReusablePhoto, type Upload } from "@/api/uploads.api";
import { cn } from "@/lib/utils";

/** "Your uploads": recent product photos the user can pick again instead of re-uploading. */
export function UploadsPicker({
  onPick,
  selectedUrl,
  limit = 8,
  className,
}: {
  onPick: (upload: Upload) => void;
  selectedUrl?: string | null;
  limit?: number;
  className?: string;
}) {
  const uploads = useQuery({ queryKey: ["uploads"], queryFn: () => UploadsApi.list() });
  const photos = (uploads.data ?? []).filter(isReusablePhoto);
  if (photos.length === 0) return null;

  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between px-1">
        <p className="text-xs font-semibold text-muted-foreground">Or pick one of your uploads</p>
        {photos.length > limit && (
          <Link href="/uploads" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            See all {photos.length}
          </Link>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {photos.slice(0, limit).map((u) => (
          <button
            key={u.id}
            type="button"
            title={u.fileName}
            onClick={() => onPick(u)}
            className={cn(
              "relative aspect-square overflow-hidden rounded-xl border bg-secondary transition-all hover:border-primary/70",
              selectedUrl === u.url ? "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.5)]" : "border-border"
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u.url} alt={u.fileName} loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}
