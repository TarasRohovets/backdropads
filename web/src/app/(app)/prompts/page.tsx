"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Clapperboard, Copy, Image as ImageIcon, MoreHorizontal, PenLine, Plus, ScrollText, Search, Trash2, WandSparkles } from "lucide-react";
import type { SavedPrompt } from "@/models";
import { PromptsApi } from "@/api/prompts.api";
import { apiError } from "@/api/client";
import { PromptEditorDialog } from "@/components/prompts/PromptEditorDialog";
import { PromptChatBox } from "@/components/prompts/PromptChatBox";
import { PromptGroupCard } from "@/components/prompts/PromptGroupCard";
import { SendToFlowDialog } from "@/components/flows/SendToFlowDialog";
import type { ComposedFlowResult } from "@/api/flows.api";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function PromptCard({ prompt, onEdit }: { prompt: SavedPrompt; onEdit: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => PromptsApi.remove(prompt.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompts"] });
      toast.success("Prompt deleted");
    },
    onError: (e) => toast.error(apiError(e).message),
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt.text);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy — select the text instead.");
    }
  };
  const Icon = prompt.kind === "video" ? Clapperboard : ImageIcon;

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-muted-foreground/40">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onEdit} className="min-w-0 text-left">
          <p className="truncate text-sm font-semibold hover:underline">{prompt.title}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider">
              <Icon className="h-3 w-3" /> {prompt.kind}
            </span>
            {prompt.useCount > 0 ? `used ${prompt.useCount}×` : `saved ${formatDistanceToNow(new Date(prompt.createdAt), { addSuffix: true })}`}
          </p>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" aria-label={`${prompt.title} actions`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onEdit}><PenLine className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={copy}><Copy className="mr-2 h-4 w-4" /> Copy text</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => remove.mutate()}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="mt-3 line-clamp-5 flex-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{prompt.text}</p>
      <Button size="sm" className="mt-4 self-start" onClick={() => router.push(`/create?promptId=${prompt.id}`)}>
        <WandSparkles className="mr-1.5 h-3.5 w-3.5" /> Use in Create
      </Button>
    </div>
  );
}

export default function PromptsPage() {
  const prompts = useQuery({ queryKey: ["prompts"], queryFn: () => PromptsApi.list() });
  const groups = useQuery({ queryKey: ["prompt-groups"], queryFn: () => PromptsApi.groups() });
  const [editing, setEditing] = useState<{ open: boolean; prompt: SavedPrompt | null }>({ open: false, prompt: null });
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const [fresh, setFresh] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<ComposedFlowResult | null>(null);

  const matches = (p: SavedPrompt) =>
    (kind === "all" || p.kind === kind) &&
    (!search.trim() || p.title.toLowerCase().includes(search.toLowerCase()) || p.text.toLowerCase().includes(search.toLowerCase()));
  const shownGroups = useMemo(
    () => (groups.data ?? []).filter((g) => (kind === "all" || g.kind === kind) && (!search.trim() || g.name.toLowerCase().includes(search.toLowerCase()) || g.prompts.some(matches))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups.data, kind, search]
  );
  const singles = useMemo(() => (prompts.data ?? []).filter((p) => !p.groupId && matches(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prompts.data, kind, search]);
  const loading = prompts.isLoading || groups.isLoading;
  const nothing = !loading && (prompts.data?.length ?? 0) === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Create</p>
          <h1 className="font-display text-3xl font-bold">Prompts</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Tell AI what you need and get one prompt per image, written for your model. Generate the whole set in a flow, or use one in Create.
          </p>
        </div>
        <Button variant="outline" onClick={() => setEditing({ open: true, prompt: null })}>
          <Plus className="mr-1.5 h-4 w-4" /> Write one yourself
        </Button>
      </div>

      {/* The default: write a set of prompts with AI */}
      <PromptChatBox onWritten={(g) => setFresh(g.id)} />

      {(prompts.data?.length ?? 0) > 0 && (
        <div className="mt-10 flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search prompts…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex rounded-full border border-border bg-secondary/60 p-1">
            {(["all", "image", "video"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-bold capitalize transition-all",
                  kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-lg" />)}
        </div>
      ) : nothing ? (
        <EmptyState
          className="mt-8"
          icon={ScrollText}
          title="No saved prompts yet"
          description="Ask AI above for the images you need, or press the bookmark in Create to save a prompt you wrote."
        />
      ) : shownGroups.length === 0 && singles.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">Nothing matches that search.</p>
      ) : (
        <div className="pb-10">
          {shownGroups.length > 0 && (
            <>
              <p className="eyebrow mt-6">Prompt sets</p>
              <div className="mt-3 space-y-3">
                {shownGroups.map((g) => (
                  <PromptGroupCard
                    key={g.id}
                    group={g}
                    highlight={g.id === fresh}
                    onEdit={(p) => setEditing({ open: true, prompt: p })}
                    onSendToFlow={setSendResult}
                  />
                ))}
              </div>
            </>
          )}
          {singles.length > 0 && (
            <>
              <p className="eyebrow mt-8">Single prompts</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {singles.map((p) => <PromptCard key={p.id} prompt={p} onEdit={() => setEditing({ open: true, prompt: p })} />)}
              </div>
            </>
          )}
        </div>
      )}

      <PromptEditorDialog open={editing.open} onOpenChange={(open) => setEditing((s) => ({ ...s, open }))} prompt={editing.prompt} />
      <SendToFlowDialog result={sendResult} onOpenChange={(open) => !open && setSendResult(null)} onResult={setSendResult} />
    </div>
  );
}
