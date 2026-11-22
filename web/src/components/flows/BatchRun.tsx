"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Images, Loader2, Upload as UploadIcon } from "lucide-react";
import { FlowsApi } from "@/api/flows.api";
import { UploadsApi, isReusablePhoto, type Upload } from "@/api/uploads.api";
import { apiError } from "@/api/client";
import { MAX_BATCH_PHOTOS, type FlowBatch } from "@/lib/flows";
import { usd } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * "Run on photos": pick up to ten photos from the library and the flow runs once for each, one after another.
 * Each photo takes the place of the photo in the flow's first step.
 */
export function BatchRunButton({
  flowId,
  costPerPhoto,
  disabled,
  beforeStart,
  onStarted,
  openOnArrival,
}: {
  flowId: string;
  /** estimated provider cost of one run of the flow, in USD */
  costPerPhoto: number;
  disabled?: boolean;
  /** save the board first, so the batch runs exactly what is on screen */
  beforeStart: () => Promise<void>;
  onStarted: (batch: FlowBatch) => void;
  /** open the photo picker right away (the flow was just made from a ready-made style) */
  openOnArrival?: boolean;
}) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(!!openOnArrival);
  const [picked, setPicked] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const uploads = useQuery({ queryKey: ["uploads"], queryFn: () => UploadsApi.list(), enabled: open });
  const photos = (uploads.data ?? []).filter(isReusablePhoto).slice(0, 60);
  const full = picked.length >= MAX_BATCH_PHOTOS;

  const toggle = (u: Upload) =>
    setPicked((urls) => (urls.includes(u.url) ? urls.filter((x) => x !== u.url) : urls.length >= MAX_BATCH_PHOTOS ? urls : [...urls, u.url]));

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, MAX_BATCH_PHOTOS)) {
        const result = await UploadsApi.upload(file, "source");
        if (result.url) added.push(result.url);
      }
      await qc.invalidateQueries({ queryKey: ["uploads"] });
      setPicked((urls) => [...urls, ...added.filter((u) => !urls.includes(u))].slice(0, MAX_BATCH_PHOTOS));
    } catch (err) {
      toast.error(apiError(err).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const start = async () => {
    setStarting(true);
    try {
      await beforeStart();
      const batch = await FlowsApi.runBatch(flowId, picked);
      onStarted(batch);
      setOpen(false);
      setPicked([]);
      toast.success(`Running on ${batch.items.length} photo${batch.items.length === 1 ? "" : "s"}, one after another`);
    } catch (err) {
      const { status, message, retryAfterSeconds } = apiError(err);
      if (status === 429) {
        toast.error(message, { description: retryAfterSeconds ? `Try again in ${Math.ceil(retryAfterSeconds / 60)} min.` : undefined });
      } else {
        toast.error(message);
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={disabled} className="h-9">
        <Images className="h-4 w-4" /> Run on photos
      </Button>

      <Dialog open={open} onOpenChange={(o) => !starting && setOpen(o)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-display">Run this flow on several photos</DialogTitle>
            <DialogDescription>
              Pick up to {MAX_BATCH_PHOTOS} photos. The flow runs once for each, one after another, and each photo takes the
              place of the photo in your first step.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">
              Your photos <span className="font-normal text-muted-foreground">· {picked.length} of {MAX_BATCH_PHOTOS} picked</span>
            </p>
            <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            <Button variant="ghost" size="sm" className="h-8 text-xs" disabled={uploading || full} onClick={() => fileInput.current?.click()}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadIcon className="h-3.5 w-3.5" />} Upload
            </Button>
          </div>

          {uploads.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : photos.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No photos in your library yet. Upload a few to get started.
            </p>
          ) : (
            <div className="grid max-h-72 grid-cols-5 gap-1.5 overflow-y-auto pr-0.5 scrollbar-thin">
              {photos.map((u) => {
                const on = picked.includes(u.url);
                return (
                  <button
                    key={u.id}
                    type="button"
                    title={u.fileName}
                    aria-pressed={on}
                    onClick={() => toggle(u)}
                    disabled={!on && full}
                    className={cn(
                      "relative aspect-square overflow-hidden rounded-lg border-2 transition",
                      on ? "border-primary" : "border-transparent hover:border-border",
                      !on && full && "opacity-40"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u.url} alt={u.fileName} className="h-full w-full object-cover" loading="lazy" />
                    {on && (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        {picked.indexOf(u.url) + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <DialogFooter className="items-center gap-3 sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {picked.length === 0
                ? `≈ ${usd(costPerPhoto)} per photo at your provider's list price`
                : `${picked.length} photo${picked.length === 1 ? "" : "s"} × ≈ ${usd(costPerPhoto)} = ≈ ${usd(picked.length * costPerPhoto)} at list prices`}
            </p>
            <Button onClick={start} disabled={picked.length === 0 || starting}>
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />}
              Run on {picked.length || ""} photo{picked.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
