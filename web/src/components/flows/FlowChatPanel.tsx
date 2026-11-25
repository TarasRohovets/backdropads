"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { ArrowUp, History, Loader2, MessageSquare, RotateCcw, Sparkles, X } from "lucide-react";
import { FlowsApi } from "@/api/flows.api";
import { apiError } from "@/api/client";
import type { FlowChatTurn, FlowDoc, FlowVersion } from "@/lib/flows";
import { PromptModelPicker, usePromptModel } from "@/components/prompts/PromptModelPicker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TIPS = [
  "Keep the 3 images, but put the product on marble in all of them",
  "Make them all vertical for stories",
  "Add a 4th image on a sunny beach",
  "Use Nano Banana Pro for every image",
];

/**
 * The chat inside a flow: ask for changes in plain words and AI edits the cards, knowing the whole flow and the chat
 * so far. Every change is a version (v1 = how it started), and any version can be restored.
 */
export function FlowChatPanel({
  flowId,
  chat,
  versions,
  current,
  disabled,
  beforeSend,
  onUpdated,
  onClose,
}: {
  flowId: string;
  chat: FlowChatTurn[];
  versions: FlowVersion[];
  /** the version the board shows now (null = hand edits since the last one) */
  current: number | null;
  /** a run is going: changes wait */
  disabled?: boolean;
  /** save the board first, so AI edits what's on screen */
  beforeSend: () => Promise<void>;
  onUpdated: (flow: FlowDoc) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const writer = usePromptModel();
  const [tab, setTab] = useState<"chat" | "versions">("chat");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, pending, tab]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      await beforeSend();
      return FlowsApi.chat(flowId, { message: text, textModel: writer.model?.id });
    },
    onMutate: (text) => {
      setPending(text);
      setMessage("");
    },
    onSuccess: (res) => {
      onUpdated(res.flow);
      qc.invalidateQueries({ queryKey: ["prompt-ai"] });
      qc.invalidateQueries({ queryKey: ["flows"] });
      if (!res.byAi) toast.message("AI editing is unavailable right now", { description: "Your note was added to every card as written." });
    },
    onError: (e, text) => {
      setMessage(text);
      const { status, message: msg, retryAfterSeconds } = apiError(e);
      toast.error(msg, {
        description: status === 429 && retryAfterSeconds ? `Try again in ${Math.ceil(retryAfterSeconds / 60)} min.` : undefined,
      });
      qc.invalidateQueries({ queryKey: ["prompt-ai"] });
    },
    onSettled: () => setPending(null),
  });

  const restore = useMutation({
    mutationFn: async (version: number) => {
      await beforeSend();
      return FlowsApi.restoreVersion(flowId, version);
    },
    onSuccess: (res, version) => {
      onUpdated(res.flow);
      toast.success(`Back to v${version}`);
      setTab("chat");
    },
    onError: (e) => toast.error(apiError(e).message),
  });

  const canSend = message.trim().length >= 2 && !send.isPending && !disabled;
  const submit = () => canSend && send.mutate(message.trim());

  return (
    // A column beside the canvas on wide screens; over it on small ones.
    <aside className="absolute inset-y-3 left-3 z-20 flex w-[min(360px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl lg:static lg:inset-auto lg:my-3 lg:ml-3 lg:w-[340px] lg:shrink-0 lg:shadow-none">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2.5">
        {(["chat", "versions"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              tab === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "chat" ? <MessageSquare className="h-3.5 w-3.5" /> : <History className="h-3.5 w-3.5" />}
            {t === "chat" ? "Chat" : `Versions${versions.length ? ` · ${versions.length}` : ""}`}
          </button>
        ))}
        <button type="button" onClick={onClose} className="ml-auto rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Close chat">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3">
        {tab === "chat" ? (
          <div className="space-y-2.5">
            {chat.length === 0 && !pending && (
              <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-iris" /> Change this flow by asking
                </p>
                <p className="mt-1">AI knows every card here. Each change is saved as a version you can go back to.</p>
              </div>
            )}
            {chat.map((t) => (
              <div key={t.id} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
                    t.role === "user" ? "rounded-br-md bg-primary/15 text-foreground" : "rounded-bl-md bg-secondary text-foreground"
                  )}
                >
                  <p className="whitespace-pre-line">{t.text}</p>
                  {t.version && (
                    <button
                      type="button"
                      onClick={() => setTab("versions")}
                      className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 font-mono text-[10px] font-bold text-iris hover:bg-background"
                    >
                      v{t.version}
                      {t.version === current && <span className="font-sans font-semibold text-muted-foreground">· current</span>}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {pending && (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary/15 px-3 py-2 text-[13px]">{pending}</div>
                </div>
                <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-iris" /> Changing the cards…
                </div>
              </>
            )}
          </div>
        ) : (
          <ol className="space-y-1.5">
            {versions.length === 0 && <p className="text-xs text-muted-foreground">No versions yet. Your first change in the chat saves v1 (how it started) and v2.</p>}
            {[...versions].reverse().map((v) => (
              <li key={v.version} className={cn("rounded-xl border px-3 py-2", v.version === current ? "border-iris/60 bg-iris/5" : "border-border")}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-iris">v{v.version}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {v.nodes.filter((n) => n.type === "output").length} card{v.nodes.filter((n) => n.type === "output").length === 1 ? "" : "s"} ·{" "}
                    {formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}
                  </span>
                  {v.version === current ? (
                    <span className="ml-auto text-[10px] font-semibold text-iris">Current</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-6 px-2 text-[11px]"
                      disabled={restore.isPending || disabled}
                      onClick={() => restore.mutate(v.version)}
                    >
                      <RotateCcw className="h-3 w-3" /> Restore
                    </Button>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-foreground/85">{v.note || "—"}</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-border p-3">
        {tab === "chat" && chat.length <= 2 && !message && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {TIPS.slice(0, 3).map((tip) => (
              <button
                key={tip}
                type="button"
                onClick={() => setMessage(tip)}
                className="rounded-full border border-dashed border-border px-2.5 py-1 text-left text-[11px] text-muted-foreground hover:border-iris/60 hover:text-foreground"
              >
                {tip}
              </button>
            ))}
          </div>
        )}
        <div className="rounded-xl border border-input bg-background/60 px-3 py-2 focus-within:border-iris">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            maxLength={2000}
            disabled={disabled}
            placeholder={disabled ? "Wait for the run to finish…" : "e.g. Keep the 3 images, but add a cup of tea in each"}
            className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70"
            aria-label="Ask for a change"
          />
          <div className="flex items-center justify-end gap-1">
            <PromptModelPicker ai={writer.ai} value={writer.model?.id} onChange={writer.choose} />
            <Button size="icon" className="h-8 w-8 rounded-full" onClick={submit} disabled={!canSend} aria-label="Send">
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
