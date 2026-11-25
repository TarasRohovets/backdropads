"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, Clapperboard, Image as ImageIcon, Images, Loader2, Paperclip, PenLine, Play, RotateCcw, ScrollText, Sparkles, X } from "lucide-react";
import { PromptsApi } from "@/api/prompts.api";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FlowsApi, type ComposedFlowResult } from "@/api/flows.api";
import { UploadsApi, type Upload } from "@/api/uploads.api";
import { apiError } from "@/api/client";
import type { OutputStepData } from "@/lib/flows";
import { LibraryDialog } from "@/components/uploads/LibraryDialog";
import { PromptModelPicker, usePromptModel } from "@/components/prompts/PromptModelPicker";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/catalog";
import { OutputModelChooser } from "@/components/flows/OutputModelChooser";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "3 Instagram images of my candle: cosy at home, wrapped as a gift, and a 20% off launch",
  "4 square ads for my running shoes, each in a different city at sunrise",
  "2 TikTok videos for my coffee: the morning ritual and a quick recipe",
];

/**
 * "Create with AI" for Flows: say what you need in one message ("3 images that do x, y and z"), and AI turns it into
 * a flow with one output per image, each with its own prompt. You see the plan and the price, then one click runs it.
 */
export function FlowComposerBox() {
  const router = useRouter();
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  // Product photos (up to 6): one builds every image, or several — "edit these 3 photos…" — one image each.
  const [photos, setPhotos] = useState<{ url: string; preview: string }[]>([]);
  const photo = photos[0] ?? null;
  const MAX_PHOTOS = 6;
  const [uploading, setUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [result, setResult] = useState<ComposedFlowResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const writer = usePromptModel();
  // From the Create box: /flows?compose=…&photos=url,url brings the message and the photos along.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const text = q.get("compose");
    if (text) setMessage(text.slice(0, 2000));
    const urls = (q.get("photos") ?? "").split(",").map((u) => u.trim()).filter(Boolean).slice(0, 6);
    if (urls.length) setPhotos(urls.map((url) => ({ url, preview: url })));
  }, []);

  const failed = (e: unknown) => {
    const { status, message: msg, retryAfterSeconds } = apiError(e);
    toast.error(msg, { description: status === 429 && retryAfterSeconds ? `Try again in ${Math.ceil(retryAfterSeconds / 60)} min.` : undefined });
  };

  const compose = useMutation({
    mutationFn: () => FlowsApi.compose({ message: message.trim(), photoUrls: photos.map((p) => p.url), textModel: writer.model?.id }),
    onSuccess: (res) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ["flows"] });
      qc.invalidateQueries({ queryKey: ["prompt-ai"] });
      if (!res.byAi) toast.message("AI planning is unavailable right now", { description: "Your message was split into outputs by hand — check the prompts." });
    },
    onError: (e) => {
      failed(e);
      qc.invalidateQueries({ queryKey: ["prompt-ai"] });
    },
  });

  // Or start from a prompt set written on the Prompts page: one image per prompt.
  const sets = useQuery({ queryKey: ["prompt-groups"], queryFn: () => PromptsApi.groups(), staleTime: 30_000 });
  const fromSet = useMutation({
    mutationFn: (groupId: string) => FlowsApi.fromPrompts({ groupId, photoUrl: photo?.url ?? null }),
    onSuccess: (res) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ["flows"] });
      qc.invalidateQueries({ queryKey: ["prompts"] });
    },
    onError: failed,
  });

  const run = useMutation({
    mutationFn: (id: string) => FlowsApi.run(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["flows"] });
      router.push(`/flows/${id}`);
    },
    onError: failed,
  });

  const upload = async (files: File[]) => {
    setUploading(true);
    try {
      for (const file of files.slice(0, MAX_PHOTOS - photos.length)) {
        const preview = URL.createObjectURL(file);
        try {
          const res = await UploadsApi.upload(file);
          setPhotos((ps) => (ps.length >= MAX_PHOTOS ? ps : [...ps, { url: res.url, preview }]));
        } catch {
          toast.error(`Couldn't upload ${file.name}.`);
        }
      }
      qc.invalidateQueries({ queryKey: ["uploads"] });
    } finally {
      setUploading(false);
    }
  };

  // The library picks several: tap to add, tap again to remove.
  const pickFromLibrary = (u: Upload) => {
    if (u.kind !== "image") return;
    setPhotos((ps) =>
      ps.some((p) => p.url === u.url) ? ps.filter((p) => p.url !== u.url) : ps.length >= MAX_PHOTOS ? ps : [...ps, { url: u.url, preview: u.url }]
    );
  };

  const reset = () => {
    setResult(null);
    setMessage("");
  };

  const canSend = message.trim().length >= 5 && message.length <= 2000 && !uploading && !compose.isPending;
  const outputs = (result?.flow.nodes ?? []).filter((n) => n.type === "output");
  const mode = (outputs[0]?.data as OutputStepData | undefined)?.mode ?? "image";
  const ratio = (outputs[0]?.data as OutputStepData | undefined)?.ratio ?? "";

  return (
    <section className="ring-neon mt-8 rounded-2xl bg-card/80 p-4 shadow-[0_30px_80px_-40px_hsl(var(--iris)/0.6)] backdrop-blur-xl sm:p-6">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-iris/15 text-iris">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-display text-lg font-bold leading-tight">Create with AI</h2>
          <p className="text-xs text-muted-foreground">Say what you need. AI builds the flow, you check the plan and the price, then generate them all at once.</p>
        </div>
      </div>

      {!result ? (
        <>
          {photos.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {photos.map((p, i) => (
                <span key={p.url} className="relative h-14 w-14 overflow-hidden rounded-xl border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                  {photos.length > 1 && (
                    <span className="absolute bottom-0.5 left-0.5 rounded-full bg-black/60 px-1.5 font-mono text-[9px] font-bold text-white">{i + 1}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPhotos((ps) => ps.filter((x) => x.url !== p.url))}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <p className="ml-1 max-w-xs text-xs text-muted-foreground">
                {photos.length === 1
                  ? "Every image builds on this product photo."
                  : `${photos.length} photos: say what to do with them — e.g. “edit these ${photos.length} photos: …” makes one image from each.`}
              </p>
            </div>
          )}
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSend) compose.mutate();
            }}
            maxLength={2000}
            rows={3}
            placeholder="e.g. I want 3 images of my candle: one cosy at home, one wrapped as a gift, one with “20% off”."
            className="mt-4 w-full resize-none bg-transparent px-1 text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 sm:text-lg"
            aria-label="What should the flow make?"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || photos.length >= MAX_PHOTOS}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 text-xs font-semibold text-secondary-foreground transition-colors hover:border-iris/60 hover:text-foreground disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
              {photos.length ? "Add photos" : "Product photos"}
            </button>
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 text-xs font-semibold text-secondary-foreground transition-colors hover:border-iris/60 hover:text-foreground"
            >
              <Images className="h-3.5 w-3.5" /> From uploads
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) upload(files);
                e.target.value = "";
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={fromSet.isPending}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 text-xs font-semibold text-secondary-foreground transition-colors hover:border-iris/60 hover:text-foreground disabled:opacity-50"
                >
                  {fromSet.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScrollText className="h-3.5 w-3.5" />} From a prompt set
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel className="eyebrow">Your prompt sets</DropdownMenuLabel>
                <div className="max-h-72 overflow-y-auto">
                  {(sets.data ?? []).length === 0 && (
                    <p className="px-2 py-2 text-xs text-muted-foreground">None yet. Write a set on the Prompts page: “3 photos: x, y, z”.</p>
                  )}
                  {(sets.data ?? []).map((g) => (
                    <DropdownMenuItem key={g.id} onClick={() => fromSet.mutate(g.id)} className="flex-col items-start gap-0.5">
                      <span className="flex w-full items-center gap-1.5">
                        {g.kind === "video" ? <Clapperboard className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ImageIcon className="h-3 w-3 shrink-0 text-muted-foreground" />}
                        <span className="truncate text-sm font-semibold">{g.name}</span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{g.prompts.length}</span>
                      </span>
                      <span className="line-clamp-1 text-[11px] text-muted-foreground">{g.prompts.map((p) => p.title).join(" · ")}</span>
                    </DropdownMenuItem>
                  ))}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/prompts"><ScrollText className="mr-2 h-3.5 w-3.5" /> Write a new set</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <LibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} selectedUrls={photos.map((p) => p.url)} onToggle={pickFromLibrary} onUploadNew={() => fileRef.current?.click()} />
            <div className="ml-auto flex items-center gap-1.5">
              <PromptModelPicker ai={writer.ai} value={writer.model?.id} onChange={writer.choose} />
              <Button size="lg" onClick={() => compose.mutate()} disabled={!canSend} className="h-11 px-5">
                {compose.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                {compose.isPending ? "Planning…" : "Build flow"}
              </Button>
            </div>
          </div>
          {!message && (
            <div className="mt-4 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setMessage(ex)}
                  className="rounded-full border border-dashed border-border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-iris/60 hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="mt-5">
          <p className="text-sm">
            <span className="font-semibold">{result.flow.name}</span>
            <span className="text-muted-foreground">
              {" "}· {outputs.length} {mode === "video" ? (outputs.length === 1 ? "video" : "videos") : outputs.length === 1 ? "image" : "images"} · {ratio}
              {result.model ? ` · planned by ${result.model}` : ""}
            </span>
          </p>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {outputs.map((n, i) => {
              const d = n.data as OutputStepData;
              const Icon = d.mode === "video" ? Clapperboard : ImageIcon;
              return (
                <li key={n.id} className="rounded-xl border border-border bg-background/50 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary font-mono text-[10px] text-primary-foreground">{i + 1}</span>
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate">{d.title}</span>
                  </p>
                  <div className="mt-1.5 flex gap-2">
                    {d.attachments?.[0]?.url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.attachments[0].url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                    )}
                    <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground">{d.prompt}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <OutputModelChooser result={result} onResult={setResult} className="mt-4" />
          {result.runError ? (
            <p className="mt-4 rounded-xl border border-honey/40 bg-honey/10 px-3 py-2 text-xs">
              {result.runError}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!result.runError && (
              <Button size="lg" onClick={() => run.mutate(result.flow.id)} disabled={run.isPending} className="h-11 px-5">
                {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                Generate {outputs.length === 1 ? "it" : `all ${outputs.length}`}
                <span className="rounded-full bg-primary-foreground/15 px-2 py-0.5 font-mono text-[10px]">≈ {usd(result.cost)}</span>
              </Button>
            )}
            <Button variant="outline" size="lg" className="h-11" onClick={() => router.push(`/flows/${result.flow.id}`)}>
              <PenLine className="h-4 w-4" /> Edit the flow first
            </Button>
            <Button variant="ghost" size="lg" className="h-11 text-muted-foreground" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> Start over
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">The flow is saved below — run it again any time, or change a prompt and run it again.</p>
        </div>
      )}
    </section>
  );
}
