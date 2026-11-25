"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, ChevronDown } from "lucide-react";
import { PromptsApi, type PromptAi } from "@/api/prompts.api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const PICK_KEY = "backdropads.promptModel";

/** The Claude models for text work, plus the model picked (remembered per browser; falls back when locked). */
export function usePromptModel() {
  const ai = useQuery({ queryKey: ["prompt-ai"], queryFn: () => PromptsApi.ai(), staleTime: 60_000 });
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPicked(localStorage.getItem(PICK_KEY));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const choose = (id: string) => {
    setPicked(id);
    try {
      localStorage.setItem(PICK_KEY, id);
    } catch {
      /* storage unavailable — the pick still applies now */
    }
  };
  const models = ai.data?.models ?? [];
  const model = models.find((m) => m.id === picked && m.available) ?? models.find((m) => m.id === ai.data?.defaultModel) ?? models[0];
  return { ai: ai.data, model, choose };
}

/** "Sonnet 5.5 ▾" next to Improve with AI: the Claude model that writes the prompt. */
export function PromptModelPicker({
  ai,
  value,
  onChange,
  className,
}: {
  ai: PromptAi | undefined;
  value: string | undefined;
  onChange: (id: string) => void;
  className?: string;
}) {
  if (!ai) return null;
  const current = ai.models.find((m) => m.id === value);
  const left = Math.max(0, ai.limit - ai.used);
  const short = (name: string) => name.replace(/^Claude /, "");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
            className
          )}
          aria-label="Model that writes the prompt"
          title="The Claude model that rewrites your prompt"
        >
          {current ? short(current.name) : "Model"}
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="eyebrow">Writes the prompt</DropdownMenuLabel>
        {ai.models.map((m) =>
          m.available ? (
            <DropdownMenuItem key={m.id} onClick={() => onChange(m.id)} className="gap-2">
              <span className="flex-1">
                <span className="block text-sm font-semibold">{m.name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {m.units === 1 ? "Fast, great for most ads" : m.units === 2 ? "More considered · about 2× the cost per request" : "Most capable · about 4× the cost per request"}
                </span>
              </span>
              {m.id === value && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          ) : null
        )}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {ai.live ? (
            "Runs on your Anthropic key. Opus and Fable cost more per request than Sonnet."
          ) : (
            "Add ANTHROPIC_API_KEY to .env to turn AI writing on. Until then your idea is laid out as a structured prompt."
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
