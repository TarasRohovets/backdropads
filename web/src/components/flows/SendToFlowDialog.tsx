"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, PenLine, Play } from "lucide-react";
import { FlowsApi, type ComposedFlowResult } from "@/api/flows.api";
import { apiError } from "@/api/client";
import type { OutputStepData } from "@/lib/flows";
import { useCatalog } from "@/hooks/use-catalog";
import { findModel, usd } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { OutputModelChooser } from "@/components/flows/OutputModelChooser";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Run a flow made from prompts: shows what it makes and the price, then "Generate all" (or open it to edit first). */
export function useRunFlow() {
  const router = useRouter();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => FlowsApi.run(id).then(() => id),
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["flows"] });
      router.push(`/flows/${id}`);
    },
    onError: (e) => toast.error(apiError(e).message),
  });
}

export function SendToFlowDialog({
  result,
  onOpenChange,
  onResult,
}: {
  result: ComposedFlowResult | null;
  onOpenChange: (open: boolean) => void;
  /** the model or quality changed: the flow and price come back */
  onResult: (result: ComposedFlowResult) => void;
}) {
  const router = useRouter();
  const run = useRunFlow();
  const catalog = useCatalog();
  const outputs = (result?.flow.nodes ?? []).filter((n) => n.type === "output");
  const first = outputs[0]?.data as OutputStepData | undefined;
  const noun = first?.mode === "video" ? (outputs.length === 1 ? "video" : "videos") : outputs.length === 1 ? "image" : "images";

  return (
    <Dialog open={!!result} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">
            {outputs.length} {noun} from “{result?.flow.name}”
          </DialogTitle>
          <DialogDescription>
            One {first?.mode === "video" ? "video" : "image"} per prompt, each made on its own · {first?.ratio} · {first ? findModel(catalog.models, first.mode, first.model).name : ""}
          </DialogDescription>
        </DialogHeader>
        <ol className="max-h-64 space-y-1.5 overflow-y-auto">
          {outputs.map((n, i) => {
            const d = n.data as OutputStepData;
            return (
              <li key={n.id} className="flex gap-2.5 rounded-lg border border-border px-3 py-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-[10px] text-primary-foreground">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{d.title}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{d.prompt}</span>
                </span>
              </li>
            );
          })}
        </ol>
        {result && <OutputModelChooser result={result} onResult={onResult} />}
        {result?.runError && (
          <p className="rounded-xl border border-honey/40 bg-honey/10 px-3 py-2 text-xs">
            {result.runError}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {result && !result.runError && (
            <Button onClick={() => run.mutate(result.flow.id)} disabled={run.isPending}>
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
              Generate {outputs.length === 1 ? "it" : `all ${outputs.length}`}
              <span className="rounded-full bg-primary-foreground/15 px-2 py-0.5 font-mono text-[10px]">≈ {usd(result.cost)}</span>
            </Button>
          )}
          {result && (
            <Button variant="outline" onClick={() => router.push(`/flows/${result.flow.id}`)}>
              <PenLine className="h-4 w-4" /> Open the flow
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
