"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, FileText } from "lucide-react";
import { UploadsApi, isReusablePhoto, type Upload } from "@/api/uploads.api";
import { cn } from "@/lib/utils";

/** Library items that can be attached to a prompt: product photos and documents (PDF / text). */
export const isAttachable = (u: Upload) => isReusablePhoto(u) || u.kind === "pdf" || u.kind === "text";

/**
 * The central upload library, for attaching earlier files to a prompt (composer and flow steps).
 * Click toggles: picked items show a check.
 */
export function LibraryPicker({
  selectedUrls,
  onToggle,
  canAddMore = true,
  className,
  listClassName = "max-h-64",
  showEmpty = false,
}: {
  selectedUrls: string[];
  onToggle: (upload: Upload) => void;
  canAddMore?: boolean;
  className?: string;
  /** height of the scrolling list */
  listClassName?: string;
  /** say so when the library is empty (instead of rendering nothing) */
  showEmpty?: boolean;
}) {
  const uploads = useQuery({ queryKey: ["uploads"], queryFn: () => UploadsApi.list() });
  const items = (uploads.data ?? []).filter(isAttachable);
  const photos = items.filter((u) => u.kind === "image").slice(0, 40);
  const docs = items.filter((u) => u.kind !== "image").slice(0, 20);
  if (items.length === 0)
    return showEmpty && !uploads.isLoading ? (
      <p className={cn("rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground", className)}>
        Your library is empty. Upload photos or documents and they'll stay here for every prompt.
      </p>
    ) : null;
  const picked = (u: Upload) => selectedUrls.includes(u.url);

  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-xs font-semibold">Your uploads</p>
        <Link href="/uploads" className="text-[11px] text-muted-foreground hover:text-foreground hover:underline">
          Manage
        </Link>
      </div>
      <div className={cn("space-y-2 overflow-y-auto scrollbar-thin pr-0.5", listClassName)}>
        {photos.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5">
            {photos.map((u) => (
              <button
                key={u.id}
                type="button"
                title={u.fileName}
                onClick={() => onToggle(u)}
                disabled={!picked(u) && !canAddMore}
                className={cn(
                  "relative aspect-square overflow-hidden rounded-lg border bg-secondary transition-all disabled:opacity-40",
                  picked(u) ? "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.5)]" : "border-border hover:border-primary/60"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u.url} alt={u.fileName} loading="lazy" className="h-full w-full object-cover" />
                {picked(u) && (
                  <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {docs.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => onToggle(u)}
            disabled={!picked(u) && !canAddMore}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors disabled:opacity-40",
              picked(u) ? "border-primary bg-primary/10" : "border-border hover:border-primary/60"
            )}
          >
            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", u.kind === "pdf" ? "bg-flame/15 text-flame" : "bg-iris/15 text-iris")}>
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{u.fileName}</span>
            {picked(u) && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </button>
        ))}
      </div>
      {docs.length > 0 && (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          PDFs and text are read by AI first. Only what matters for the ad goes into the image or video prompt.
        </p>
      )}
    </div>
  );
}
