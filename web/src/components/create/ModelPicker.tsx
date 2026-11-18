"use client";

import { Check, Cpu, Timer } from "lucide-react";
import type { AiModel } from "@/models";
import { usd } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** "≈ $0.13" per image or "≈ $0.10/s" per second at the chosen quality — the provider's list price, an estimate. */
export const modelPrice = (model: AiModel, quality: "standard" | "high") => {
  const rate = quality === "high" ? model.costUsdHigh : model.costUsd;
  return model.unit === "second" ? `≈ ${usd(rate)}/s` : `≈ ${usd(rate)}`;
};

const TAG_STYLES: Record<string, string> = {
  Recommended: "bg-primary/15 text-primary",
  Cheapest: "bg-mint/15 text-mint",
  Premium: "bg-flame/15 text-flame",
  UGC: "bg-iris/15 text-iris",
};

interface ModelPickerProps {
  models: AiModel[];
  value: AiModel;
  quality: "standard" | "high";
  onChange: (model: AiModel) => void;
  /** the catalog's pre-selected model, badged "Default" */
  defaultId?: string;
  /** trigger styling — the composer and the flow inspector use different shells */
  triggerClassName?: string;
  align?: "start" | "end";
}

/** Model menu: name, maker, what it's good at, and its price at the current quality. */
export function ModelPicker({ models, value, quality, onChange, defaultId, triggerClassName, align = "start" }: ModelPickerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Model" className={triggerClassName}>
          <Cpu className="h-3.5 w-3.5" />
          <span className="max-w-[9rem] truncate">{value.name}</span>
          <span className="font-mono text-[10px] opacity-60">{modelPrice(value, quality)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-[26rem] w-[21rem] overflow-y-auto">
        <DropdownMenuLabel className="eyebrow">{value.unit === "second" ? "Video model" : "Image model"}</DropdownMenuLabel>
        {models.map((m) => (
          <DropdownMenuItem key={m.id} onClick={() => onChange(m)} className={cn("items-start gap-3 py-2.5", m.configured === false && "opacity-60")}>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold">{m.name}</span>
                <span className="text-[11px] text-muted-foreground">{m.vendor}</span>
                {m.id === defaultId && (
                  <span className="rounded-full bg-secondary px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-foreground">Default</span>
                )}
                {m.configured === false && (
                  <span className="rounded-full bg-flame-soft px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-flame">No API key</span>
                )}
                {m.tags.map((t) => (
                  <span key={t} className={cn("rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide", TAG_STYLES[t] ?? "bg-secondary text-secondary-foreground")}>
                    {t}
                  </span>
                ))}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{m.tagline}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
              <span className="font-mono text-[11px] font-semibold">{modelPrice(m, quality)}</span>
              {value.id === m.id ? <Check className="h-3.5 w-3.5 text-primary" /> : <span className="w-3.5" />}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface DurationPickerProps {
  model: AiModel;
  quality: "standard" | "high";
  value: number;
  onChange: (seconds: number) => void;
  triggerClassName?: string;
}

/** Clip length, limited to what the model can render. */
export function DurationPicker({ model, quality, value, onChange, triggerClassName }: DurationPickerProps) {
  const rate = quality === "high" ? model.costUsdHigh : model.costUsd;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Video length" className={triggerClassName}>
          <Timer className="h-3.5 w-3.5" /> {value}s
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel className="eyebrow">Length</DropdownMenuLabel>
        {model.durations.map((d) => (
          <DropdownMenuItem key={d} onClick={() => onChange(d)}>
            <span className="font-mono text-xs">{d}s</span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">≈ {usd(rate * d)}</span>
            {value === d && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
