"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clapperboard, Image as ImageIcon, Loader2, Undo2, WandSparkles } from "lucide-react";
import type { SavedPrompt } from "@/models";
import { PromptsApi, type ImprovePromptRequest } from "@/api/prompts.api";
import { apiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PromptModelPicker, usePromptModel } from "@/components/prompts/PromptModelPicker";

type Kind = "image" | "video";

/** "Improve with AI" as a reusable mutation, with the toasts for limits and the no-AI fallback. */
export function useImprovePrompt(onDone: (result: { title: string; prompt: string; model?: string | null }) => void) {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (body: ImprovePromptRequest) => PromptsApi.improve(body),
    onSuccess: (res) => {
      onDone(res);
      qc.invalidateQueries({ queryKey: ["prompt-ai"] });
      if (!res.byAi) toast.message("AI writing is unavailable right now", { description: "Your idea was laid out as a structured prompt instead." });
    },
    onError: (e) => {
      const { status, message, retryAfterSeconds } = apiError(e);
      toast.error(message, {
        description: status === 429 && retryAfterSeconds ? `Try again in ${Math.ceil(retryAfterSeconds / 60)} min.` : undefined,
      });
      qc.invalidateQueries({ queryKey: ["prompt-ai"] });
    },
  });
}

/** Create or edit a saved prompt, with "Improve with AI" on the text. */
export function PromptEditorDialog({
  open,
  onOpenChange,
  prompt,
  initial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** editing an existing prompt */
  prompt?: SavedPrompt | null;
  /** starting values for a new prompt (e.g. "Save" from Create) */
  initial?: { title?: string; text?: string; kind?: Kind };
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind>("image");
  const [before, setBefore] = useState<string | null>(null);
  const writer = usePromptModel();

  useEffect(() => {
    if (!open) return;
    setTitle(prompt?.title ?? initial?.title ?? "");
    setText(prompt?.text ?? initial?.text ?? "");
    setKind(prompt?.kind ?? initial?.kind ?? "image");
    setBefore(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prompt?.id]);

  const improve = useImprovePrompt((res) => {
    setBefore(text);
    setText(res.prompt);
    if (!title.trim()) setTitle(res.title);
  });

  const save = useMutation({
    mutationFn: () =>
      prompt
        ? PromptsApi.update(prompt.id, { title: title.trim(), text: text.trim(), kind })
        : PromptsApi.create({ title: title.trim() || undefined, text: text.trim(), kind }),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["prompts"] });
      toast.success(prompt ? "Prompt saved" : `Saved “${saved.title}” to Prompts`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{prompt ? "Edit prompt" : "New prompt"}</DialogTitle>
          <DialogDescription>
            Write what you want in your own words, then let AI rewrite it the way image and video models understand best.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="prompt-title">Name</Label>
            <Input id="prompt-title" maxLength={80} placeholder="e.g. Autumn candle, cosy window" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>For</Label>
            <div className="flex rounded-full border border-border bg-secondary/60 p-1">
              {(["image", "video"] as const).map((k) => {
                const Icon = k === "image" ? ImageIcon : Clapperboard;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold capitalize transition-all",
                      kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {k}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="prompt-text">Prompt</Label>
            <div className="flex items-center gap-1.5">
              {before !== null && (
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { setText(before); setBefore(null); }}>
                  <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo
                </Button>
              )}
              <PromptModelPicker ai={writer.ai} value={writer.model?.id} onChange={writer.choose} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 border-iris/50 text-xs"
                disabled={text.trim().length < 3 || text.length > 2000 || improve.isPending}
                title={text.length > 2000 ? "Improve works on up to 2,000 characters" : undefined}
                onClick={() => improve.mutate({ idea: text, mode: kind, aspectRatio: kind === "video" ? "9:16" : "4:5", brandKitId: "primary", textModel: writer.model?.id })}
              >
                {improve.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="mr-1 h-3.5 w-3.5 text-iris" />}
                Improve with AI
              </Button>
            </div>
          </div>
          <Textarea
            id="prompt-text"
            rows={9}
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={kind === "image"
              ? "e.g. my lavender candle on a windowsill on a rainy autumn evening, cosy, warm"
              : "e.g. 10s TikTok: hands unbox my sneakers, quick cuts, ends on the shoe on a city street"}
            className="font-sans text-sm leading-relaxed"
          />
          <p className="text-right font-mono text-[10px] text-muted-foreground">{text.length} / 4000</p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!text.trim() || save.isPending}>
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {prompt ? "Save changes" : "Save prompt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
