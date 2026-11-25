"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Gem, Loader2 } from "lucide-react";
import { FlowsApi, type ComposedFlowResult } from "@/api/flows.api";
import { apiError } from "@/api/client";
import { estimateCost, normalizeNode, type FlowNode, type OutputStepData } from "@/lib/flows";
import { findModel, modelUsesPhotos } from "@/lib/catalog";
import { useCatalog } from "@/hooks/use-catalog";
import { ModelPicker } from "@/components/create/ModelPicker";
import { cn } from "@/lib/utils";

const PILL =
  "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 text-xs font-semibold text-secondary-foreground transition-colors hover:border-iris/60 hover:text-foreground disabled:opacity-50";

/**
 * Before running a flow made from prompts: pick the image (or video) model and the quality for every card at once.
 * Saves it on the flow and gives back the new price.
 */
export function OutputModelChooser({ result, onResult, className }: { result: ComposedFlowResult; onResult: (r: ComposedFlowResult) => void; className?: string }) {
  const catalog = useCatalog();
  const [saving, setSaving] = useState(false);
  const outputs = result.flow.nodes.filter((n) => n.type === "output");
  const first = outputs[0] ? (normalizeNode(outputs[0]).data as OutputStepData) : null;
  if (!first) return null;
  const mode = first.mode;
  const model = findModel(catalog.models, mode, first.model);

  const apply = async (patch: Partial<OutputStepData>) => {
    setSaving(true);
    try {
      const nodes = result.flow.nodes.map((n) =>
        n.type === "output" && (n.data as OutputStepData).mode === mode ? ({ ...n, data: { ...n.data, ...patch } } as FlowNode) : n
      );
      const flow = await FlowsApi.update(result.flow.id, { nodes });
      onResult({ ...result, flow, cost: estimateCost(flow.nodes.map(normalizeNode), catalog) });
    } catch (e) {
      toast.error(apiError(e).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-xs text-muted-foreground">{mode === "video" ? "Video model" : "Image model"}</span>
      <ModelPicker
        models={catalog.models[mode]}
        value={model}
        quality={first.quality}
        onChange={(m) => m.id !== model.id && apply({ model: m.id })}
        defaultId={model.id}
        triggerClassName={PILL}
      />
      <button
        type="button"
        disabled={saving}
        onClick={() => apply({ quality: first.quality === "high" ? "standard" : "high" })}
        className={cn(PILL, first.quality === "high" && "border-flame/60 text-flame")}
        title={mode === "image" ? "High = 2K / extra detail" : "1080p (720p standard)"}
      >
        <Gem className="h-3.5 w-3.5" />
        {mode === "image" ? (first.quality === "high" ? "High" : "Standard") : first.quality === "high" ? "1080p" : "720p"}
      </button>
      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {outputs.some((n) => (n.data as OutputStepData).attachments?.some((a) => a.url)) && !modelUsesPhotos(model) && (
        <span className="text-xs font-semibold text-honey">{model.name} ignores your photos — pick a model that edits them (Nano Banana, GPT Image).</span>
      )}
    </div>
  );
}
