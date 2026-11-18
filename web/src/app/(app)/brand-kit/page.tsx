"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe, MoreHorizontal, Palette, Pencil, Plus, Trash2, Type } from "lucide-react";
import type { BrandKit } from "@/models";
import { BrandKitApi } from "@/api/brandkit.api";
import { apiError } from "@/api/client";
import { BrandKitEditor } from "@/components/brand/BrandKitEditor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function BrandCard({ kit, onEdit, onDelete }: { kit: BrandKit; onEdit: () => void; onDelete: () => void }) {
  const isPrimary = (kit.id ?? "primary") === "primary";
  const initial = kit.brandName?.trim()?.[0]?.toUpperCase() ?? "?";
  const context = kit.context || kit.guidelines || kit.productInfo || kit.tone;

  return (
    <div className="card-hover group flex flex-col rounded-2xl border border-border bg-card/70 p-5 backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border font-display text-lg font-bold"
          style={{ background: kit.logoUrl ? "#FFFFFF" : kit.colors[0] ?? "hsl(var(--iris))", color: "#08070F" }}
        >
          {kit.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={kit.logoUrl} alt="" className="h-full w-full object-contain p-1.5" />
          ) : (
            initial
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-bold">{kit.brandName || "Untitled brand"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {isPrimary && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">Default</span>
            )}
            {kit.websiteUrl && (
              <span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground">
                <Globe className="h-3 w-3 shrink-0" />
                {kit.websiteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
              </span>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" aria-label="Brand actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            {!isPrimary && (
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Colors */}
      <div className="mt-4 flex h-10 overflow-hidden rounded-xl">
        {kit.colors.map((c, i) => (
          <span key={i} className="flex-1" style={{ background: c }} title={c} />
        ))}
      </div>

      {/* Fonts */}
      {kit.fonts?.some((f) => f) && (
        <p className="mt-3 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <Type className="h-3.5 w-3.5 shrink-0" />
          {kit.fonts.filter(Boolean).join(" · ")}
        </p>
      )}

      {/* Context */}
      <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-muted-foreground">
        {context || "No context yet — add who you are and how you talk."}
      </p>

      <Button variant="outline" size="sm" className="mt-4 w-full" onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" /> Edit brand
      </Button>
    </div>
  );
}

export default function BrandKitPage() {
  const qc = useQueryClient();
  const kits = useQuery({ queryKey: ["brand-kits"], queryFn: () => BrandKitApi.list() });

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<BrandKit | null>(null);

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (kit: BrandKit) => {
    setEditing(kit);
    setEditorOpen(true);
  };

  const remove = useMutation({
    mutationFn: (id: string) => BrandKitApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brand-kits"] });
      toast.success("Brand deleted");
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Library</p>
          <h1 className="font-display text-3xl font-bold">Brand Kit</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Logo, colors, fonts and context for each brand you make ads for. Pick one when you generate.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Add brand
        </Button>
      </div>

      {kits.isLoading ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-2xl" />
          ))}
        </div>
      ) : kits.isError ? (
        <p className="mt-8 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Couldn't load your brands. Is the API running?
        </p>
      ) : (
        <div className="mt-8 grid gap-4 pb-10 sm:grid-cols-2 lg:grid-cols-3">
          {kits.data!.map((kit) => (
            <BrandCard
              key={kit.id ?? "primary"}
              kit={kit}
              onEdit={() => openEdit(kit)}
              onDelete={() => remove.mutate(kit.id!)}
            />
          ))}
          <button
            type="button"
            onClick={openNew}
            className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary">
              <Palette className="h-5 w-5" />
            </span>
            <span className="text-sm font-bold">Add a brand</span>
            <span className="max-w-[14rem] text-center text-xs">Scan a website or set it up by hand.</span>
          </button>
        </div>
      )}

      <BrandKitEditor open={editorOpen} onOpenChange={setEditorOpen} kit={editing} />
    </div>
  );
}
