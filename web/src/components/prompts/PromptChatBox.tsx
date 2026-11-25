"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, Clapperboard, Image as ImageIcon, Loader2, Sparkles } from "lucide-react";
import type { PromptGroup } from "@/models";
import { PromptsApi } from "@/api/prompts.api";
import { apiError } from "@/api/client";
import { useCatalog } from "@/hooks/use-catalog";
import { defaultModelId, findModel } from "@/lib/catalog";
import { ModelPicker } from "@/components/create/ModelPicker";
import { PromptModelPicker, usePromptModel } from "@/components/prompts/PromptModelPicker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PILL =
  "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 text-xs font-semibold text-secondary-foreground transition-colors hover:border-iris/60 hover:text-foreground";

const EXAMPLES = [
  "I need 3 photos of my candle: cosy at home, wrapped as a gift, and with “20% off”",
  "4 prompts for my running shoes, each in a different city at sunrise",
  "2 TikTok video prompts for my coffee: the morning ritual and a quick recipe",
];

/**
 * "Write with AI" on the Prompts page: one message → a group of prompts, each written for the chosen image or video
 * model (Nano Banana Pro, Veo…). The group can go to Flows (one image each); any prompt can go to Create for one image.
 */
export function PromptChatBox({ onWritten }: { onWritten: (group: PromptGroup) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const catalog = useCatalog();
  const writer = usePromptModel();
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"image" | "video">("image");
  const [targets, setTargets] = useState<Partial<Record<"image" | "video", string>>>({});
  const target = findModel(catalog.models, mode, targets[mode] ?? defaultModelId(catalog, mode));

  const compose = useMutation({
    mutationFn: () => PromptsApi.compose({ message: message.trim(), mode, targetModel: target.id, textModel: writer.model?.id }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["prompt-groups"] });
      qc.invalidateQueries({ queryKey: ["prompts"] });
      qc.invalidateQueries({ queryKey: ["prompt-ai"] });
      setMessage("");
      onWritten(res.group);
      toast.success(`${res.group.prompts.length} prompts written`, {
        description: res.byAi ? `By ${res.model}, for ${res.group.targetModelName ?? "any model"}.` : "AI is unavailable right now — your message was split by hand.",
      });
    },
    onError: (e) => {
      const { status, message: msg, retryAfterSeconds } = apiError(e);
      toast.error(msg, {
        description: status === 429 && retryAfterSeconds ? `Try again in ${Math.ceil(retryAfterSeconds / 60)} min.` : undefined,
      });
      qc.invalidateQueries({ queryKey: ["prompt-ai"] });
    },
  });
  const canSend = message.trim().length >= 5 && message.length <= 2000 && !compose.isPending;

  return (
    <section className="ring-neon mt-8 rounded-2xl bg-card/80 p-4 backdrop-blur-xl sm:p-6">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-iris/15 text-iris">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-display text-lg font-bold leading-tight">Write prompts with AI</h2>
          <p className="text-xs text-muted-foreground">Say what you need. You get one prompt per image, written for the model you pick.</p>
        </div>
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSend) compose.mutate();
        }}
        maxLength={2000}
        rows={3}
        placeholder="e.g. I need 3 photos of my candle: cosy at home, wrapped as a gift, and with “20% off”."
        className="mt-4 w-full resize-none bg-transparent px-1 text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 sm:text-lg"
        aria-label="What prompts do you need?"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-border bg-secondary/60 p-1">
          {(["image", "video"] as const).map((m) => {
            const Icon = m === "image" ? ImageIcon : Clapperboard;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold capitalize transition-all",
                  mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {m}
              </button>
            );
          })}
        </div>
        <span className="text-[11px] text-muted-foreground">for</span>
        <ModelPicker
          models={catalog.models[mode]}
          value={target}
          quality="standard"
          onChange={(m) => setTargets((t) => ({ ...t, [mode]: m.id }))}
          defaultId={defaultModelId(catalog, mode)}
          triggerClassName={PILL}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <PromptModelPicker ai={writer.ai} value={writer.model?.id} onChange={writer.choose} />
          <Button size="lg" onClick={() => compose.mutate()} disabled={!canSend} className="h-11 px-5">
            {compose.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            {compose.isPending ? "Writing…" : "Write prompts"}
          </Button>
        </div>
      </div>
      {!message && (
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setMessage(ex);
                if (ex.includes("video")) setMode("video");
              }}
              className="rounded-full border border-dashed border-border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-iris/60 hover:text-foreground"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
