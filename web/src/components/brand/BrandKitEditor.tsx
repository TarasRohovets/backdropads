"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Globe, ImageOff, Loader2, Plus, ScanSearch, Sparkles, Upload, X } from "lucide-react";
import type { BrandKit } from "@/models";
import { BrandKitApi, type BrandKitInput } from "@/api/brandkit.api";
import { UploadsApi } from "@/api/uploads.api";
import { apiError } from "@/api/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DEFAULT_COLORS = ["#C4FF3A", "#8B5CF6", "#0B0A14"];

/** Load a Google Font on demand so the font fields preview the real typeface. */
function useGoogleFont(family: string) {
  useEffect(() => {
    const name = family.trim();
    if (!name || typeof document === "undefined") return;
    const id = `gf-${name.replace(/\s+/g, "-").toLowerCase()}`;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  }, [family]);
}

function FontField({ id, label, value, onChange, sample }: { id: string; label: string; value: string; onChange: (v: string) => void; sample: string }) {
  useGoogleFont(value);
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="mt-1.5" placeholder="e.g. Inter" value={value} onChange={(e) => onChange(e.target.value)} />
      <p
        className="mt-2 truncate rounded-xl bg-secondary/60 px-3 py-2 text-lg"
        style={{ fontFamily: value ? `"${value}", system-ui, sans-serif` : undefined }}
      >
        {sample}
      </p>
    </div>
  );
}

/** Older kits kept voice/product/guidelines in separate fields — fold them into the single context prompt. */
function contextOf(kit?: BrandKit | null) {
  if (!kit) return "";
  if (kit.context) return kit.context;
  return [kit.tone && `Voice: ${kit.tone}`, kit.productInfo, kit.guidelines].filter(Boolean).join("\n\n");
}

interface BrandKitEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this kit; omit to create a new one. */
  kit?: BrandKit | null;
  onSaved?: (kit: BrandKit) => void;
}

/**
 * The one brand kit editor, used on the Brand Kit page and from the composer's brand pill.
 * New kits start with an optional website scan; everything found is shown for review before saving.
 */
export function BrandKitEditor({ open, onOpenChange, kit, onSaved }: BrandKitEditorProps) {
  const qc = useQueryClient();
  const editing = !!kit;

  const [step, setStep] = useState<"scan" | "review">(editing ? "review" : "scan");
  const [scanUrl, setScanUrl] = useState("");
  const [scannedFrom, setScannedFrom] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoCandidates, setLogoCandidates] = useState<string[]>([]);
  const [logoBroken, setLogoBroken] = useState(false);
  const [colors, setColors] = useState<string[]>(DEFAULT_COLORS);
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [context, setContext] = useState("");
  const [uploading, setUploading] = useState(false);

  // Reset whenever the dialog opens (for a new kit or a different one).
  useEffect(() => {
    if (!open) return;
    setStep(kit ? "review" : "scan");
    setScanUrl(kit?.websiteUrl ?? "");
    setScannedFrom(null);
    setName(kit?.brandName ?? "");
    setLogoUrl(kit?.logoUrl ?? null);
    setLogoCandidates([]);
    setLogoBroken(false);
    setColors(kit?.colors?.length ? [...kit.colors] : DEFAULT_COLORS);
    setHeading(kit?.fonts?.[0] ?? "");
    setBody(kit?.fonts?.[1] ?? "");
    setContext(contextOf(kit));
  }, [open, kit]);

  const scan = useMutation({
    mutationFn: () => BrandKitApi.scan(scanUrl),
    onSuccess: (draft) => {
      setName(draft.brandName);
      setLogoUrl(draft.logoUrl ?? null);
      setLogoCandidates(draft.logoCandidates ?? []);
      setLogoBroken(false);
      if (draft.colors.length) setColors(draft.colors);
      setHeading(draft.fonts[0] ?? "");
      setBody(draft.fonts[1] ?? draft.fonts[0] ?? "");
      if (draft.context) setContext(draft.context);
      setScannedFrom(draft.sourceUrl);
      setStep("review");
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const save = useMutation({
    mutationFn: () => {
      const input: BrandKitInput = {
        brandName: name.trim(),
        logoUrl,
        colors,
        fonts: [heading.trim(), body.trim()],
        context: context.trim() || null,
        websiteUrl: scannedFrom ?? (scanUrl.trim() || kit?.websiteUrl || null),
      };
      return editing ? BrandKitApi.update(kit!.id ?? "primary", input) : BrandKitApi.create(input);
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["brand-kits"] });
      qc.invalidateQueries({ queryKey: ["brand-kit"] });
      toast.success(editing ? `${saved.brandName} updated` : `${saved.brandName} added`);
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const res = await UploadsApi.upload(file, "logo");
      setLogoUrl(res.url);
      setLogoBroken(false);
    } catch {
      toast.error("Logo upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto scrollbar-thin sm:max-w-lg">
        {step === "scan" ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">Add a brand</DialogTitle>
              <DialogDescription>
                Paste your website — we'll pull the logo, colors, fonts and a description. You check everything before it's saved.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (scanUrl.trim().length > 3) scan.mutate();
              }}
            >
              <div className="relative">
                <Globe className="absolute left-4 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="yourbrand.com"
                  className="h-11 pl-10"
                  value={scanUrl}
                  onChange={(e) => setScanUrl(e.target.value)}
                  aria-label="Website address"
                  disabled={scan.isPending}
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={scanUrl.trim().length < 4 || scan.isPending}>
                {scan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                {scan.isPending ? "Reading your site…" : "Scan website"}
              </Button>
            </form>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>
            <Button variant="outline" className="w-full" onClick={() => setStep("review")} disabled={scan.isPending}>
              Start from scratch
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">{editing ? `Edit ${kit!.brandName || "brand"}` : "Review your brand"}</DialogTitle>
              <DialogDescription>
                {scannedFrom ? (
                  <>
                    Found on <span className="font-semibold text-foreground">{scannedFrom.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span> — fix anything that's off, then save.
                  </>
                ) : (
                  "The AI reads this before every ad it makes for this brand."
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              {/* Logo + name */}
              <div className="flex items-start gap-4">
                <div className="shrink-0">
                  <div
                    className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-border"
                    style={{ background: "repeating-conic-gradient(#E9E7F0 0% 25%, #FFFFFF 0% 50%) 50% / 12px 12px" }}
                  >
                    {logoUrl && !logoBroken ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt="Logo" className="h-full w-full object-contain p-2" onError={() => setLogoBroken(true)} />
                    ) : (
                      <ImageOff className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="mt-2 flex gap-1">
                    <label className="flex h-7 flex-1 cursor-pointer items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground" title="Upload logo">
                      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                    </label>
                    {logoUrl && (
                      <button type="button" onClick={() => setLogoUrl(null)} className="flex h-7 flex-1 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground" title="Remove logo">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <Label htmlFor="bkName">Brand name</Label>
                    <Input id="bkName" className="mt-1.5" placeholder="e.g. Northwind Coffee" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  {logoCandidates.length > 1 && (
                    <div>
                      <p className="eyebrow mb-1.5">Other logos we found</p>
                      <div className="flex flex-wrap gap-1.5">
                        {logoCandidates.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => {
                              setLogoUrl(c);
                              setLogoBroken(false);
                            }}
                            className={cn(
                              "h-10 w-10 overflow-hidden rounded-xl border bg-white p-1 transition-colors",
                              logoUrl === c ? "border-primary" : "border-border hover:border-iris/60"
                            )}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={c} alt="" className="h-full w-full object-contain" onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.2")} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Colors */}
              <div>
                <Label>Colors</Label>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {colors.map((c, i) => (
                    <div key={i} className="group relative">
                      <input
                        type="color"
                        value={c}
                        onChange={(e) => setColors((cs) => cs.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))}
                        className="h-12 w-12 cursor-pointer rounded-2xl border border-border bg-transparent"
                        aria-label={`Color ${i + 1}`}
                      />
                      <span className="mt-0.5 block text-center font-mono text-[9px] text-muted-foreground">{c}</span>
                      {colors.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove ${c}`}
                          onClick={() => setColors((cs) => cs.filter((_, j) => j !== i))}
                          className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-secondary p-0.5 text-muted-foreground group-hover:block"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                  {colors.length < 6 && (
                    <button
                      type="button"
                      onClick={() => setColors((cs) => [...cs, "#FFFFFF"])}
                      className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-border text-muted-foreground hover:border-iris/60 hover:text-foreground"
                      aria-label="Add color"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Fonts */}
              <div className="grid gap-4 sm:grid-cols-2">
                <FontField id="bkHeading" label="Heading font" value={heading} onChange={setHeading} sample={name || "Big bold headline"} />
                <FontField id="bkBody" label="Body font" value={body} onChange={setBody} sample="The quick brown fox" />
              </div>

              {/* Context */}
              <div>
                <Label htmlFor="bkContext">Brand context</Label>
                <Textarea
                  id="bkContext"
                  className="mt-1.5 min-h-28"
                  placeholder="Who you are, who you sell to, how you talk, what to always say and never say…"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">Saved with the brand and added to every prompt.</p>
              </div>

              <div className="flex gap-2">
                {!editing && (
                  <Button variant="outline" onClick={() => setStep("scan")} disabled={save.isPending}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </Button>
                )}
                <Button className="flex-1" size="lg" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {editing ? "Save changes" : "Save brand"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
