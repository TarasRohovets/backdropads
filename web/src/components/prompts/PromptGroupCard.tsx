"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Copy, Loader2, MoreHorizontal, PenLine, Trash2, WandSparkles, Workflow } from "lucide-react";
import type { PromptGroup, SavedPrompt } from "@/models";
import { PromptsApi } from "@/api/prompts.api";
import { FlowsApi, type ComposedFlowResult } from "@/api/flows.api";
import { apiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** One prompt group: its prompts in order. "Generate all in a flow" makes one image per prompt; "Use in Create" makes one. */
export function PromptGroupCard({
  group,
  highlight,
  onEdit,
  onSendToFlow,
}: {
  group: PromptGroup;
  highlight?: boolean;
  onEdit: (prompt: SavedPrompt) => void;
  onSendToFlow: (result: ComposedFlowResult) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => setName(group.name), [group.name]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["prompt-groups"] });
    qc.invalidateQueries({ queryKey: ["prompts"] });
  };

  const toFlow = useMutation({
    mutationFn: () => FlowsApi.fromPrompts({ groupId: group.id }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      onSendToFlow(res);
    },
    onError: (e) => toast.error(apiError(e).message),
  });
  const rename = useMutation({
    mutationFn: () => PromptsApi.renameGroup(group.id, name.trim()),
    onSuccess: () => {
      refresh();
      setRenaming(false);
    },
    onError: (e) => toast.error(apiError(e).message),
  });
  const remove = useMutation({
    mutationFn: () => PromptsApi.removeGroup(group.id),
    onSuccess: () => {
      refresh();
      toast.success(`Deleted “${group.name}”`);
    },
    onError: (e) => toast.error(apiError(e).message),
  });
  const removePrompt = useMutation({
    mutationFn: (id: string) => PromptsApi.remove(id),
    onSuccess: refresh,
    onError: (e) => toast.error(apiError(e).message),
  });
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy — select the text instead.");
    }
  };

  const noun = group.kind === "video" ? "video" : "image";
  const n = group.prompts.length;

  return (
    <article className={cn("rounded-2xl border bg-card p-4 transition-colors sm:p-5", highlight ? "border-iris/70 shadow-[0_0_0_1px_hsl(var(--iris)/0.4)]" : "border-border")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-bold">{group.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {n} {noun} prompt{n === 1 ? "" : "s"}
            {group.targetModelName ? ` · for ${group.targetModelName}` : ""} · {group.ratio} · {formatDistanceToNow(new Date(group.createdAt), { addSuffix: true })}
          </p>
          {group.message && <p className="mt-1.5 line-clamp-1 text-xs italic text-muted-foreground/80">“{group.message}”</p>}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={() => toFlow.mutate()} disabled={toFlow.isPending || n === 0}>
            {toFlow.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Workflow className="h-3.5 w-3.5" />}
            Generate all {n > 1 ? n : ""} in a flow
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={`${group.name} actions`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setRenaming(true)}>
                <PenLine className="mr-2 h-4 w-4" /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleting(true)}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete group
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ol className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {group.prompts.map((p, i) => (
          <li key={p.id} className="flex flex-col rounded-xl border border-border bg-background/50 p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-[10px]">{i + 1}</span>
              <span className="truncate">{p.title}</span>
            </p>
            <p className="mt-1.5 line-clamp-4 flex-1 text-xs leading-relaxed text-muted-foreground">{p.text}</p>
            <div className="mt-3 flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => router.push(`/create?promptId=${p.id}`)}>
                <WandSparkles className="h-3 w-3" /> Use in Create
              </Button>
              <Button size="icon" variant="ghost" className="ml-auto h-7 w-7 text-muted-foreground" onClick={() => copy(p.text)} aria-label="Copy prompt">
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={() => onEdit(p)} aria-label="Edit prompt">
                <PenLine className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removePrompt.mutate(p.id)} aria-label="Delete prompt">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ol>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) rename.mutate(); }}>
            <DialogHeader><DialogTitle>Rename group</DialogTitle></DialogHeader>
            <Input autoFocus className="mt-4" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            <DialogFooter className="mt-6">
              <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
              <Button type="submit" disabled={!name.trim() || rename.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{group.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Its {n} prompt{n === 1 ? "" : "s"} go too. Ads and flows you made with them stay.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete group</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
