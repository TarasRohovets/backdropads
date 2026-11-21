"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { ArrowRight, Clapperboard, Copy, Image as ImageIcon, Loader2, MoreHorizontal, Plus, Trash2, Workflow } from "lucide-react";
import type { FlowDoc, FlowTemplate } from "@/lib/flows";
import { FlowsApi } from "@/api/flows.api";
import { apiError } from "@/api/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** A tiny left-to-right sketch of the flow's cards. */
function FlowSketch({ flow }: { flow: FlowDoc }) {
  const steps = [...flow.nodes].sort((a, b) => a.position.x - b.position.x);
  let n = 0;
  return (
    <div className="flex h-12 w-full items-center gap-1 overflow-hidden rounded-xl bg-[radial-gradient(hsl(var(--foreground)/0.08)_1px,transparent_1px)] bg-[length:12px_12px] px-2.5">
      {steps.slice(0, 5).map((s, i) => {
        const isOut = s.type === "output";
        const video = isOut && (s.data as { mode?: string }).mode === "video";
        if (!isOut) n++;
        return (
          <div key={s.id} className="flex items-center gap-1">
            {i > 0 && <span className="h-px w-2.5 bg-iris/70" />}
            <span
              className={cn(
                "flex h-7 items-center justify-center rounded-lg px-1.5 font-mono text-[10px] font-bold",
                isOut ? "bg-primary text-primary-foreground" : "border border-iris/40 bg-iris/10 text-iris"
              )}
            >
              {isOut ? video ? <Clapperboard className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" /> : String(n).padStart(2, "0")}
            </span>
          </div>
        );
      })}
      {steps.length > 5 && <span className="text-[10px] text-muted-foreground">+{steps.length - 5}</span>}
    </div>
  );
}

export default function FlowsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const flows = useQuery({ queryKey: ["flows"], queryFn: () => FlowsApi.list() });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("blank");
  const templates = useQuery({ queryKey: ["flow-templates"], queryFn: () => FlowsApi.templates(), enabled: open, staleTime: Infinity });

  const create = useMutation({
    mutationFn: () => FlowsApi.create(name.trim(), templateId),
    onSuccess: (flow) => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      setOpen(false); // close right away; the board opens next
      router.push(`/flows/${flow.id}`);
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const copy = useMutation({
    mutationFn: (id: string) => FlowsApi.duplicate(id),
    onSuccess: (flow) => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      toast.success(`Copied as "${flow.name}"`, { action: { label: "Open", onClick: () => router.push(`/flows/${flow.id}`) } });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => FlowsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      toast.success("Flow deleted");
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const openNew = () => {
    setName("");
    setTemplateId("blank");
    setOpen(true);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Create</p>
          <h1 className="font-display text-3xl font-bold">
            <span className="text-neon">Flows</span>
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Chain prompts into a pipeline — rebrand, stage, refine — and end with the images or videos you need. Run it on one photo, or on up to 10 at a time.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> New flow
        </Button>
      </div>

      {flows.isLoading ? (
        <div className="mt-8 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[74px] rounded-2xl" />
          ))}
        </div>
      ) : flows.isError ? (
        <p className="mt-8 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Couldn't load your flows. Is the API running?</p>
      ) : (flows.data?.length ?? 0) === 0 ? (
        <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-iris/15 text-iris">
            <Workflow className="h-6 w-6" />
          </span>
          <h2 className="mt-4 font-display text-xl font-bold">Build your first flow</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Each card is a prompt with its own files. Connect them with arrows — every step builds on the last — and finish with an output.
          </p>
          <Button className="mt-6" onClick={openNew}>
            <Plus className="h-4 w-4" /> New flow
          </Button>
        </div>
      ) : (
        <ul className="mt-8 space-y-2 pb-10">
          {flows.data!.map((f) => {
            const prompts = f.nodes.filter((n) => n.type === "prompt").length;
            const outs = f.nodes.filter((n) => n.type === "output").length;
            const status = f.lastRun?.status;
            return (
              <li
                key={f.id}
                className="group relative flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-3 transition-colors hover:border-iris/50"
              >
                <Link href={`/flows/${f.id}`} className="absolute inset-0 rounded-2xl" aria-label={`Open ${f.name}`} />
                <div className="hidden w-48 shrink-0 sm:block">
                  <FlowSketch flow={f} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-display text-base font-bold">
                    <span className="truncate">{f.name}</span>
                    {status === "running" ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                        <Loader2 className="h-3 w-3 animate-spin" /> Running
                      </span>
                    ) : status === "completed" ? (
                      <span className="shrink-0 rounded-full bg-mint-soft px-2 py-0.5 text-[10px] font-bold text-mint">Last run done</span>
                    ) : status === "failed" ? (
                      <span className="shrink-0 rounded-full bg-flame-soft px-2 py-0.5 text-[10px] font-bold text-flame">Last run failed</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {prompts} {prompts === 1 ? "step" : "steps"} · {outs} {outs === 1 ? "output" : "outputs"}
                    <span className="sm:hidden"> · edited {formatDistanceToNow(new Date(f.updatedAt), { addSuffix: true })}</span>
                  </p>
                </div>
                <span className="hidden shrink-0 text-xs text-muted-foreground md:block">
                  Edited {formatDistanceToNow(new Date(f.updatedAt), { addSuffix: true })}
                </span>
                <Button asChild size="sm" variant="outline" className="relative z-10 hidden shrink-0 sm:inline-flex">
                  <Link href={`/flows/${f.id}`}>
                    Open <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative z-10 h-8 w-8 shrink-0 text-muted-foreground" aria-label="Flow actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => copy.mutate(f.id)}>
                      <Copy className="mr-2 h-4 w-4" /> Copy flow
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => remove.mutate(f.id)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-display">New flow</DialogTitle>
            <DialogDescription>Start from a ready-made flow or a blank one. You can change every step afterwards.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto pr-0.5 sm:grid-cols-2">
              {(templates.data ?? []).map((t: FlowTemplate) => {
                const on = t.id === templateId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTemplateId(t.id)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition",
                      on ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"
                    )}
                  >
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      {t.mode === "video" ? <Clapperboard className="h-3.5 w-3.5 text-iris" /> : <ImageIcon className="h-3.5 w-3.5 text-iris" />}
                      {t.name}
                    </p>
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">{t.description}</p>
                    {t.id !== "blank" && (
                      <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t.steps.join(" → ")} → {t.mode} {t.ratio}
                      </p>
                    )}
                  </button>
                );
              })}
              {templates.isLoading && <p className="col-span-full py-6 text-center text-xs text-muted-foreground">Loading starter flows…</p>}
            </div>
            <div>
              <Label htmlFor="flowName">Name</Label>
              <Input id="flowName" className="mt-1.5" placeholder="e.g. Summer serum launch" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create flow <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
