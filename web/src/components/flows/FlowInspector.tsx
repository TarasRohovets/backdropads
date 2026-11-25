"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Clapperboard, Copy, FileText, Gem, Image as ImageIcon, Images, Link2, Loader2, Paperclip, Trash2, X } from "lucide-react";
import type { FlowAttachment, FlowNode, OutputStepData, PromptStepData } from "@/lib/flows";
import { uid } from "@/lib/flows";
import { ATTACHMENT_ACCEPT, ATTACHMENT_HINT, attachmentKind, formatBytes, validateAttachment } from "@/lib/attachments";
import { UploadsApi, type Upload } from "@/api/uploads.api";
import { LibraryDialog } from "@/components/uploads/LibraryDialog";
import { BrandKitApi } from "@/api/brandkit.api";
import { PLATFORMS, PLATFORM_RULES, ratioCss } from "@/lib/taxonomy";
import type { Platform } from "@/models";
import { cn } from "@/lib/utils";
import { defaultModelId, findModel, modelUnitCost, snapDuration, usd } from "@/lib/catalog";
import { useCatalog } from "@/hooks/use-catalog";
import { DurationPicker, ModelPicker } from "@/components/create/ModelPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const RATIOS = { image: ["1:1", "4:5", "9:16", "2:3"], video: ["9:16", "1:1", "16:9"] } as const;

interface FlowInspectorProps {
  node: FlowNode;
  stepNumber: number;
  onChange: (patch: Partial<PromptStepData> | Partial<OutputStepData>) => void;
  onClose: () => void;
  /** Save the flow now and close the panel. */
  onSave: () => Promise<void> | void;
  onDelete: () => void;
  onDuplicate: () => void;
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-full border border-border bg-secondary/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all",
            value === o.value ? "bg-primary text-primary-foreground glow-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Side panel for the selected card: a big prompt + attachments, or the output settings. */
export function FlowInspector({ node, stepNumber, onChange, onClose, onSave, onDelete, onDuplicate }: FlowInspectorProps) {
  const catalog = useCatalog();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const brandKits = useQuery({ queryKey: ["brand-kits"], queryFn: () => BrandKitApi.list() });
  const isPrompt = node.data.kind === "prompt";

  const addFiles = async (files: FileList | null) => {
    if (!files || !isPrompt) return;
    const d = node.data as PromptStepData;
    let current = [...d.attachments];
    for (const file of Array.from(files)) {
      const problem = validateAttachment(file);
      if (problem) {
        toast.error(problem);
        continue;
      }
      const att: FlowAttachment = { id: uid("att"), name: file.name, kind: attachmentKind(file)!, size: file.size, url: null };
      current = [...current, att];
      onChange({ attachments: current });
      setUploading((n) => n + 1);
      try {
        const res = await UploadsApi.upload(file, "attachment");
        current = current.map((a) => (a.id === att.id ? { ...a, url: res.url } : a));
        onChange({ attachments: current });
        qc.invalidateQueries({ queryKey: ["uploads"] });
      } catch {
        current = current.filter((a) => a.id !== att.id);
        onChange({ attachments: current });
        toast.error(`Couldn't upload ${file.name}.`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  // Attach from the central upload library (photos + PDFs / text).
  const toggleFromLibrary = (u: Upload) => {
    if (!isPrompt) return;
    const current = (node.data as PromptStepData).attachments;
    onChange({
      attachments: current.some((a) => a.url === u.url)
        ? current.filter((a) => a.url !== u.url)
        : [...current, { id: uid("att"), name: u.fileName, kind: u.kind === "image" ? "image" : u.kind === "pdf" ? "pdf" : "text", size: u.sizeBytes, url: u.url }],
    });
  };

  return (
    // Solid panel: a backdrop blur over the canvas repaints on every pan/zoom.
    <aside className="absolute inset-y-3 right-3 z-10 flex w-[min(420px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <span
          className={cn(
            "flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-bold",
            isPrompt ? "bg-iris/15 text-iris" : "bg-primary text-primary-foreground"
          )}
        >
          {isPrompt ? String(stepNumber).padStart(2, "0") : node.data.kind === "output" && node.data.mode === "video" ? <Clapperboard className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
        </span>
        <Input
          value={node.data.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="h-9 flex-1 border-transparent bg-transparent px-2 font-display text-base font-bold hover:border-border focus:border-input"
          aria-label="Step name"
        />
        <button type="button" onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Close panel">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto scrollbar-thin px-5 py-5">
        {node.data.kind === "prompt" ? (
          <>
            <div>
              <Label htmlFor="stepPrompt">Prompt</Label>
              <textarea
                id="stepPrompt"
                value={node.data.prompt}
                onChange={(e) => onChange({ prompt: e.target.value })}
                placeholder="What should this step do? Be as detailed as you like — describe the scene, what to keep, what to change, the mood, any text that must appear…"
                className="mt-1.5 min-h-[260px] w-full resize-y rounded-xl border border-input bg-background/60 px-4 py-3 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-iris"
              />
              <p className="mt-1 text-right font-mono text-[10px] text-muted-foreground">{node.data.prompt.length} chars</p>
            </div>

            {stepNumber > 1 && (
              <label className="flex items-start justify-between gap-4 rounded-xl border border-border bg-secondary/40 p-3">
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Link2 className="h-3.5 w-3.5" /> Build on the previous step
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">Use the result of the step before as this step's input image.</span>
                </span>
                <Switch checked={node.data.usePrevious} onCheckedChange={(v) => onChange({ usePrevious: v })} aria-label="Use previous result" />
              </label>
            )}

            {/* Attachments: only what this step uses. The library opens on demand. */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
            >
              <div className="flex items-baseline justify-between">
                <Label>Attachments</Label>
                <span className="text-[11px] text-muted-foreground">Photos, briefs (PDF), product copy (text)</span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
                  <Images className="h-3.5 w-3.5" /> Upload library
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading > 0}>
                  {uploading > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />} Upload new
                </Button>
              </div>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ATTACHMENT_ACCEPT}
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              {node.data.attachments.length === 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Nothing attached. {ATTACHMENT_HINT}. You can also drop files here.
                </p>
              )}
              <LibraryDialog
                open={libraryOpen}
                onOpenChange={setLibraryOpen}
                selectedUrls={node.data.attachments.map((a) => a.url ?? "")}
                onToggle={toggleFromLibrary}
                onUploadNew={() => fileRef.current?.click()}
              />
              {node.data.attachments.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {node.data.attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3 py-2">
                      {a.kind === "image" && a.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.url} alt="" className="h-9 w-9 rounded-lg object-cover" />
                      ) : (
                        <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", a.kind === "pdf" ? "bg-flame/15 text-flame" : "bg-iris/15 text-iris")}>
                          {a.kind === "image" ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">{a.name}</span>
                        <span className="font-mono text-[10px] uppercase text-muted-foreground">
                          {a.kind} · {formatBytes(a.size)} {!a.url && "· uploading…"}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onChange({ attachments: (node.data as PromptStepData).attachments.filter((x) => x.id !== a.id) })}
                        className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        aria-label={`Remove ${a.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor="outputPrompt">What to make</Label>
              <textarea
                id="outputPrompt"
                value={node.data.prompt ?? ""}
                maxLength={4000}
                onChange={(e) => onChange({ prompt: e.target.value })}
                placeholder="Optional. Used when no step is connected to this card: describe the image or video to make."
                className="mt-1.5 min-h-[120px] w-full resize-y rounded-xl border border-input bg-background/60 px-4 py-3 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-iris"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Connected to a step? The step's result and prompts are used instead.</p>
              {(node.data.attachments ?? []).filter((a) => a.url).map((a) => (
                <div key={a.id} className="mt-2 flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3 py-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url!} alt="" className="h-9 w-9 rounded-lg object-cover" />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => onChange({ attachments: ((node.data as OutputStepData).attachments ?? []).filter((x) => x.id !== a.id) })}
                    className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    aria-label={`Remove ${a.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div>
              <Label>Output type</Label>
              <div className="mt-1.5">
                <Segmented
                  value={node.data.mode}
                  onChange={(mode) => {
                    const d = node.data as OutputStepData;
                    const rules = d.platform ? PLATFORM_RULES[d.platform as Platform] : [];
                    const rule = rules.find((r) => r.placement === d.placement && r.creativeTypes.includes(mode)) ?? rules.find((r) => r.creativeTypes.includes(mode));
                    onChange({
                      mode,
                      count: mode === "video" ? 1 : d.count,
                      model: defaultModelId(catalog, mode),
                      durationSeconds: null,
                      ...(rule ? { placement: rule.placement, ratio: rule.aspectRatio } : { platform: null, placement: null, ratio: RATIOS[mode][0] }),
                    });
                  }}
                  options={[
                    { value: "image", label: <><ImageIcon className="h-3.5 w-3.5" /> Image</> },
                    { value: "video", label: <><Clapperboard className="h-3.5 w-3.5" /> Video</> },
                  ]}
                />
              </div>
            </div>
            <div>
              <Label>Where it will run</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[{ id: "", label: "Anywhere" }, ...PLATFORMS].map((p) => {
                  const on = ((node.data as OutputStepData).platform ?? "") === p.id;
                  return (
                    <button
                      key={p.id || "any"}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const d = node.data as OutputStepData;
                        if (!p.id) return onChange({ platform: null, placement: null });
                        // first format of this platform that takes the current kind of ad, else its first format
                        const rules = PLATFORM_RULES[p.id as Platform];
                        const rule = rules.find((r) => r.creativeTypes.includes(d.mode)) ?? rules[0];
                        const mode = rule.creativeTypes.includes(d.mode) ? d.mode : "video";
                        onChange({
                          platform: p.id,
                          placement: rule.placement,
                          ratio: rule.aspectRatio,
                          ...(mode !== d.mode ? { mode, count: 1, model: defaultModelId(catalog, mode), durationSeconds: null } : {}),
                        });
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                        on ? "border-primary text-foreground" : "border-border text-muted-foreground hover:border-iris/60"
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              {(node.data as OutputStepData).platform && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PLATFORM_RULES[(node.data as OutputStepData).platform as Platform].map((r) => {
                    const d = node.data as OutputStepData;
                    const on = d.placement === r.placement;
                    const videoOnly = !r.creativeTypes.includes("image");
                    return (
                      <button
                        key={r.placement}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          const mode = r.creativeTypes.includes(d.mode) ? d.mode : videoOnly ? "video" : "image";
                          onChange({
                            placement: r.placement,
                            ratio: r.aspectRatio,
                            ...(mode !== d.mode ? { mode, count: 1, model: defaultModelId(catalog, mode), durationSeconds: null } : {}),
                          });
                        }}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                          on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:border-iris/60"
                        )}
                      >
                        {r.label} <span className="font-mono text-[10px] font-normal text-muted-foreground">{r.aspectRatio}{videoOnly ? " · video" : !r.creativeTypes.includes("video") ? " · image" : ""}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {(node.data as OutputStepData).platform ? "The format sets the size for you." : "Pick a platform to get the right format, or choose a size yourself."}
              </p>
            </div>
            {!(node.data as OutputStepData).platform && (
            <div>
              <Label>Size</Label>
              <div className="mt-1.5 grid grid-cols-4 gap-2">
                {RATIOS[node.data.mode].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => onChange({ ratio: r })}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl border py-2.5 font-mono text-[11px] transition-colors",
                      (node.data as OutputStepData).ratio === r ? "border-primary text-foreground" : "border-border text-muted-foreground hover:border-iris/60"
                    )}
                  >
                    <span className="block h-5 rounded-[3px] border-[1.5px] border-current" style={{ aspectRatio: ratioCss(r) }} />
                    {r}
                  </button>
                ))}
              </div>
            </div>
            )}
            <div>
              <Label>How many</Label>
              <div className="mt-1.5">
                <Segmented
                  value={String(node.data.count) as "1"}
                  onChange={(v) => onChange({ count: Number(v) })}
                  options={(node.data.mode === "video" ? ["1", "2"] : ["1", "2", "3", "4", "6"]).map((n) => ({ value: n as "1", label: `×${n}` }))}
                />
              </div>
            </div>
            <OutputModelFields data={node.data} onChange={onChange} />
            <div>
              <Label>Quality</Label>
              <div className="mt-1.5">
                <Segmented
                  value={node.data.quality}
                  onChange={(quality) => onChange({ quality })}
                  options={
                    node.data.mode === "image"
                      ? [
                          { value: "standard", label: "Standard" },
                          { value: "high", label: <><Gem className="h-3.5 w-3.5" /> High</> },
                        ]
                      : [
                          { value: "standard", label: "720p" },
                          { value: "high", label: <><Gem className="h-3.5 w-3.5" /> 1080p</> },
                        ]
                  }
                />
              </div>
            </div>
            <div>
              <Label>Brand kit</Label>
              <div className="mt-1.5 space-y-1.5">
                {[...(brandKits.data ?? []), { id: "none", brandName: "No brand kit", colors: [] as string[] }].map((k) => {
                  const id = k.id ?? "primary";
                  const active = (node.data as OutputStepData).brandKitId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onChange({ brandKitId: id })}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                        active ? "border-primary bg-primary/10" : "border-border hover:border-iris/60"
                      )}
                    >
                      <span className="flex -space-x-1">
                        {k.colors.slice(0, 3).map((c, i) => (
                          <span key={i} className="h-4 w-4 rounded-full border border-card" style={{ background: c }} />
                        ))}
                        {k.colors.length === 0 && <span className="h-4 w-4 rounded-full border border-dashed border-muted-foreground/50" />}
                      </span>
                      <span className="font-semibold">{k.brandName}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-2 border-t border-border px-5 py-3">
        <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
        <Button variant="outline" size="sm" onClick={onDuplicate}>
          <Copy className="h-3.5 w-3.5" /> Duplicate
        </Button>
        <Button size="sm" className="ml-auto" onClick={save} disabled={saving || uploading > 0}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
        </Button>
      </div>
    </aside>
  );
}

const FIELD =
  "flex h-10 w-full items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 text-sm font-semibold transition-colors hover:border-iris/60";

/** Model + (video) length for an output card, with the live price of this card. */
function OutputModelFields({ data, onChange }: { data: OutputStepData; onChange: (patch: Partial<OutputStepData>) => void }) {
  const catalog = useCatalog();
  const model = findModel(catalog.models, data.mode, data.model);
  const duration = snapDuration(model, data.durationSeconds);
  const cost = modelUnitCost(model, data.quality, duration) * data.count;
  return (
    <div>
      <Label className="flex items-center justify-between">
        Model <span className="font-mono text-[11px] font-normal text-muted-foreground">≈ {usd(cost)} for this card</span>
      </Label>
      <div className={cn("mt-1.5 grid gap-2", data.mode === "video" && "grid-cols-[1fr_auto]")}>
        <ModelPicker
          models={catalog.models[data.mode]}
          defaultId={defaultModelId(catalog, data.mode)}
          value={model}
          quality={data.quality}
          onChange={(m) => onChange({ model: m.id, durationSeconds: m.unit === "second" ? snapDuration(m, data.durationSeconds) : null })}
          triggerClassName={FIELD}
        />
        {data.mode === "video" && (
          <DurationPicker model={model} quality={data.quality} value={duration} onChange={(s) => onChange({ durationSeconds: s })} triggerClassName={FIELD} />
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{model.tagline}</p>
    </div>
  );
}
