"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { ExternalLink, FileText, Film, ImageUp, Loader2, Trash2, Upload as UploadIcon, WandSparkles } from "lucide-react";
import { UploadsApi, isReusablePhoto, type Upload } from "@/api/uploads.api";
import { apiError } from "@/api/client";
import { formatBytes } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { ANALYZE_ENABLED } from "@/lib/features";

type Filter = "photos" | "logos" | "ads" | "files" | "all";

const FILTERS: { id: Filter; label: string; match: (u: Upload) => boolean }[] = [
  { id: "photos", label: "Photos", match: isReusablePhoto },
  { id: "logos", label: "Logos", match: (u) => u.purpose === "logo" },
  ...(ANALYZE_ENABLED ? [{ id: "ads" as Filter, label: "Analyzed ads", match: (u: Upload) => u.purpose === "ad" }] : []),
  { id: "files", label: "Files", match: (u) => u.kind === "pdf" || u.kind === "text" },
  { id: "all", label: "All", match: () => true },
];

function UploadCard({ upload, onDelete }: { upload: Upload; onDelete: () => void }) {
  return (
    <div className="group overflow-hidden rounded-2xl border border-border bg-card">
      <div className="relative aspect-square bg-secondary">
        {upload.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={upload.url} alt={upload.fileName} loading="lazy" className="h-full w-full object-cover" />
        ) : upload.kind === "video" ? (
          <video src={upload.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <FileText className="absolute inset-0 m-auto h-8 w-8 text-muted-foreground" />
        )}
        {upload.kind === "video" && (
          <Film className="absolute left-2 top-2 h-4 w-4 text-white drop-shadow" />
        )}
        <div className="absolute inset-x-2 bottom-2 flex justify-end gap-1.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <a
            href={upload.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open file"
            className="rounded-full bg-black/60 p-2 text-white backdrop-blur hover:bg-black/80"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            aria-label="Delete upload"
            onClick={onDelete}
            className="rounded-full bg-black/60 p-2 text-white backdrop-blur hover:bg-flame"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="space-y-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" title={upload.fileName}>{upload.fileName}</p>
          <p className="text-xs text-muted-foreground">
            {format(new Date(upload.createdAt), "d MMM yyyy")} · {formatBytes(upload.sizeBytes)}
          </p>
        </div>
        {isReusablePhoto(upload) && (
          <Button asChild size="sm" variant="outline" className="w-full">
            <Link href={`/create?uploadId=${upload.id}`}>
              <WandSparkles className="mr-1.5 h-3.5 w-3.5" /> Create ad
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export default function UploadsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("photos");
  const [pendingDelete, setPendingDelete] = useState<Upload | null>(null);
  const [uploading, setUploading] = useState(0);
  const uploads = useQuery({ queryKey: ["uploads"], queryFn: () => UploadsApi.list() });

  const remove = useMutation({
    mutationFn: (id: string) => UploadsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["uploads"] });
      toast.success("Upload deleted");
    },
    onError: (e) => toast.error(apiError(e).message),
    onSettled: () => setPendingDelete(null),
  });

  const addFiles = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name}: pick an image (PNG, JPG, WebP).`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        await UploadsApi.upload(file);
      } catch (e) {
        toast.error(`${file.name}: ${apiError(e).message}`);
      } finally {
        setUploading((n) => n - 1);
        qc.invalidateQueries({ queryKey: ["uploads"] });
      }
    }
  };

  const all = uploads.data ?? [];
  const current = FILTERS.find((f) => f.id === filter)!;
  const shown = all.filter(current.match);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Library</p>
          <h1 className="font-display text-3xl font-bold">Uploads</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every photo and file you've uploaded. Make a new ad from any photo.</p>
        </div>
        <Button asChild>
          <label className="cursor-pointer">
            {uploading > 0 ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UploadIcon className="mr-1.5 h-4 w-4" />}
            Upload photos
            <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
          </label>
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = all.filter(f.match).length;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === f.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label} <span className="opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {uploads.isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/5] rounded-2xl" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <ImageUp className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-semibold">{filter === "photos" ? "No photos yet" : `No ${current.label.toLowerCase()} yet`}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Photos you use in Create, Flows or Brand Kit show up here, so you can reuse them any time.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {shown.map((u) => (
              <UploadCard key={u.id} upload={u} onDelete={() => setPendingDelete(u)} />
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this upload?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.fileName} will be removed from your library and storage. Ads you already made from it stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-flame text-flame-foreground hover:bg-flame/90"
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) remove.mutate(pendingDelete.id);
              }}
            >
              {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
