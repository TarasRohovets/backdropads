"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DEFAULT_CATALOG, usd } from "@/lib/catalog";

interface RefineBoxProps {
  onRefine: (instruction: string) => Promise<unknown> | void;
  pending?: boolean;
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
}

/**
 * The refine loop in one line: say what to change, get a new version.
 * Replaces "open a new chat and re-upload" — the image stays the anchor.
 */
export function RefineBox({
  onRefine,
  pending = false,
  placeholder,
  className,
  size = "md",
}: RefineBoxProps) {
  const [value, setValue] = useState("");
  const canSubmit = value.trim().length >= 3 && !pending;
  const hint = placeholder ?? (size === "sm" ? "Refine this…" : "Refine: softer shadow, move it left, add a hand…");

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    await onRefine(value.trim());
    setValue("");
  };

  return (
    <form onSubmit={submit} className={cn("flex items-center gap-1.5", className)}>
      <Input
        maxLength={500}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={hint}
        disabled={pending}
        className={cn(size === "sm" ? "h-8 text-xs" : "h-9 text-sm")}
        aria-label="Refine instruction"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={!canSubmit} className="shrink-0 hover:bg-iris/20 hover:text-foreground">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        <span className={cn("ml-1.5", size === "sm" && "sr-only")}>Refine</span>
        {!pending && (
          <span className="ml-1.5 rounded-full bg-background/20 px-1.5 py-0.5 font-mono text-[9px]" title="Estimated cost of one edit at list price">
            ≈ {usd(DEFAULT_CATALOG.editCostUsd)}
          </span>
        )}
      </Button>
    </form>
  );
}

interface VersionStripProps {
  versions: { key: string; version: number; label?: string | null }[];
  current: number;
  onSelect: (version: number) => void;
  className?: string;
}

/** v1 · v2 · v3 — click to view any version; the latest is highlighted by default. */
export function VersionStrip({ versions, current, onSelect, className }: VersionStripProps) {
  if (versions.length <= 1) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <span className="mr-1 font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">versions</span>
      {versions.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => onSelect(v.version)}
          title={v.label ?? (v.version === 1 ? "Original" : undefined)}
          className={cn(
            "rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors",
            v.version === current
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          )}
        >
          v{v.version}
        </button>
      ))}
    </div>
  );
}
