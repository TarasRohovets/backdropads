"use client";

import { Fragment, forwardRef, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUp,
  Bookmark,
  Check,
  Clapperboard,
  FileText,
  Gem,
  Image as ImageIcon,
  Loader2,
  Package,
  Palette,
  Paperclip,
  Pencil,
  Plus,
  ScrollText,
  SlidersHorizontal,
  WandSparkles,
  X,
} from "lucide-react";
import type { BrandKit, Brief, CreativeType, Placement, Platform, SavedPrompt } from "@/models";
import { PromptsApi } from "@/api/prompts.api";
import { PromptEditorDialog, useImprovePrompt } from "@/components/prompts/PromptEditorDialog";
import { PromptModelPicker, usePromptModel } from "@/components/prompts/PromptModelPicker";
import { wantsSeveral } from "@/components/flows/MassGenerationBanner";
import { GenerationsApi } from "@/api/generations.api";
import { UploadsApi, type Upload } from "@/api/uploads.api";
import { LibraryPicker } from "@/components/uploads/LibraryPicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProductsApi } from "@/api/products.api";
import { BrandKitApi } from "@/api/brandkit.api";
import { apiError } from "@/api/client";
import { ratioCss } from "@/lib/taxonomy";
import { ATTACHMENT_ACCEPT, ATTACHMENT_HINT, attachmentKind, validateAttachment, type AttachmentKind } from "@/lib/attachments";
import { DEFAULT_LANGUAGE, DEFAULT_MARKET } from "@/lib/locales";
import { cn } from "@/lib/utils";
import { defaultModelId, findModel, modelUnitCost, modelUsesPhotos, snapDuration, usd } from "@/lib/catalog";
import { useCatalog } from "@/hooks/use-catalog";
import { Button } from "@/components/ui/button";
import { DurationPicker, ModelPicker } from "@/components/create/ModelPicker";
import { BrandKitEditor } from "@/components/brand/BrandKitEditor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Mode = "image" | "video";
type Quality = "standard" | "high";

interface RatioOption {
  ratio: string;
  label: string;
  platform: Platform;
  placement: Placement;
}

// Each ratio maps onto a valid platform/placement combo from the taxonomy.
const RATIOS: Record<Mode, RatioOption[]> = {
  image: [
    { ratio: "1:1", label: "Square", platform: "facebook", placement: "feed" },
    { ratio: "4:5", label: "Portrait", platform: "instagram", placement: "feed" },
    { ratio: "9:16", label: "Story", platform: "instagram", placement: "story" },
    { ratio: "2:3", label: "Pin", platform: "pinterest", placement: "pin" },
  ],
  video: [
    { ratio: "9:16", label: "Vertical", platform: "tiktok", placement: "video" },
    { ratio: "1:1", label: "Square", platform: "facebook", placement: "feed" },
    { ratio: "16:9", label: "Landscape", platform: "youtube", placement: "video" },
  ],
};

/** Where the ad starts from — set by the Create page; the dashboard omits it (free prompt). */
export interface ComposerSource {
  kind: "image" | "url" | "describe";
  imageUrl?: string | null;
  productUrl?: string | null;
  /** read off the product page (URL source) */
  product?: { title: string; description?: string | null; brand?: string | null; price?: string | null; currency?: string | null } | null;
  /** Source-specific input is complete (image uploaded / valid URL). */
  ready: boolean;
}

interface PromptComposerProps {
  source?: ComposerSource;
  placeholder?: string;
  initialMode?: Mode;
  initialProductId?: string | null;
  templateId?: string | null;
  /** A saved prompt to start from (/create?promptId=…). */
  initialPrompt?: SavedPrompt | null;
  className?: string;
}

interface Attachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  /** object URL for image previews; null for PDF/text */
  previewUrl: string | null;
  url: string | null;
  uploading: boolean;
}

/** "34.00" + "EUR" → "€34.00"; unknown currencies fall back to "34.00 CHF". */
export function formatPrice(price: string, currency?: string | null): string {
  const n = Number(price);
  if (!currency || Number.isNaN(n)) return price;
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(n);
  } catch {
    return `${price} ${currency}`;
  }
}

/** The user's last model pick per mode (image / video), so the composer reopens on it. */
const MODEL_PICKS_KEY = "backdropads.modelPicks";

const PILL =
  "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 text-xs font-semibold text-secondary-foreground transition-colors hover:border-iris/60 hover:text-foreground disabled:opacity-50";

const Pill = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(function Pill(
  { children, className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(PILL, className)}
      {...props}
    >
      {children}
    </button>
  );
});

/**
 * The shared composer: prompt + attachments + mode / size / quality / count / product / brand kit.
 * Used as the dashboard front door (free prompt) and on the Create page (with a source).
 */
export function PromptComposer({
  source,
  placeholder,
  initialMode = "image",
  initialProductId = null,
  templateId = null,
  initialPrompt = null,
  className,
}: PromptComposerProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [prompt, setPrompt] = useState("");
  // A short name from a saved or AI-written prompt; names the ad instead of the prompt's first words.
  const [promptTitle, setPromptTitle] = useState<string | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [ratio, setRatio] = useState<RatioOption>(RATIOS[initialMode][initialMode === "image" ? 1 : 0]);
  const [quality, setQuality] = useState<Quality>("standard");
  const [count, setCount] = useState(1);
  const [productId, setProductId] = useState<string | null>(initialProductId);
  const [brandKitId, setBrandKitId] = useState<string>("primary");
  const [kitEditor, setKitEditor] = useState<{ open: boolean; kit: BrandKit | null }>({ open: false, kit: null });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [seconds, setSeconds] = useState<number | null>(null);
  const catalog = useCatalog();
  // Starts on the catalog default (images: Nano Banana Pro); the user's last pick per mode wins once loaded.
  const [modelIds, setModelIds] = useState<Partial<Record<Mode, string>>>({});
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(MODEL_PICKS_KEY) ?? "{}") as Partial<Record<Mode, string>>;
      setModelIds((ids) => ({ ...saved, ...ids }));
    } catch {
      /* storage unavailable — keep the defaults */
    }
  }, []);
  const pickModel = (m: Mode, id: string) =>
    setModelIds((ids) => {
      const next = { ...ids, [m]: id };
      try {
        localStorage.setItem(MODEL_PICKS_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — the pick still applies for this session */
      }
      return next;
    });

  const products = useQuery({ queryKey: ["products"], queryFn: () => ProductsApi.list() });
  const brandKits = useQuery({ queryKey: ["brand-kits"], queryFn: () => BrandKitApi.list() });
  const product = products.data?.find((p) => p.id === productId) ?? null;
  const brandKit = brandKitId === "none" ? null : brandKits.data?.find((k) => (k.id ?? "primary") === brandKitId) ?? null;

  const maxCount = mode === "video" ? 2 : 4;
  const effectiveCount = Math.min(count, maxCount);
  const model =
    catalog.models[mode].find((m) => m.id === modelIds[mode]) ?? findModel(catalog.models, mode, defaultModelId(catalog, mode));
  const duration = snapDuration(model, seconds);
  const totalCost = modelUnitCost(model, quality, duration) * effectiveCount;
  const uploading = attachments.some((a) => a.uploading);
  const hasImage = (source?.kind !== "describe" && !!source?.imageUrl) || attachments.some((a) => a.kind === "image" && a.url);
  const needsPhoto = model.needsImage && !hasImage;

  const promptOk = source
    ? source.kind === "describe"
      ? prompt.trim().length >= 10
      : true
    : prompt.trim().length >= 4 || !!product;
  const canGenerate = promptOk && (!source || source.ready) && !uploading && !needsPhoto;

  const switchMode = (next: Mode) => {
    setMode(next);
    const same = RATIOS[next].find((r) => r.ratio === ratio.ratio);
    setRatio(same ?? RATIOS[next][0]);
    if (next === "video") setCount((c) => Math.min(c, 2));
  };

  const savedPrompts = useQuery({ queryKey: ["prompts"], queryFn: () => PromptsApi.list(), staleTime: 30_000 });
  const promptGroups = useQuery({ queryKey: ["prompt-groups"], queryFn: () => PromptsApi.groups(), staleTime: 30_000 });
  const applyPrompt = (p: SavedPrompt) => {
    setPrompt(p.text);
    setPromptTitle(p.title);
    if (p.kind !== mode) switchMode(p.kind);
    // Written for a particular model (Nano Banana Pro…): use that one, when this install has it.
    if (p.targetModel && catalog.models[p.kind].some((m) => m.id === p.targetModel)) pickModel(p.kind, p.targetModel);
    PromptsApi.use(p.id).then(() => qc.invalidateQueries({ queryKey: ["prompts"] })).catch(() => undefined);
  };
  const loadedPrompt = useRef<string | null>(null);
  useEffect(() => {
    if (!initialPrompt || loadedPrompt.current === initialPrompt.id) return;
    loadedPrompt.current = initialPrompt.id;
    applyPrompt(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt?.id]);

  // "Improve with AI": rewrite the box's text for the chosen kind of model; one click undoes it.
  const writer = usePromptModel();
  const improve = useImprovePrompt((res) => {
    const previous = prompt;
    setPrompt(res.prompt);
    setPromptTitle(res.title);
    toast.success("Prompt rewritten for the model", {
      description: `${res.model ? `Written by ${res.model}. ` : ""}Edit it as you like, or save it for next time.`,
      action: { label: "Undo", onClick: () => { setPrompt(previous); setPromptTitle(null); } },
    });
  });

  // The central upload library (photos + PDFs / text) is offered in the Attach menu — nothing needs re-uploading.
  const [attachOpen, setAttachOpen] = useState(false);

  const toggleFromLibrary = (u: Upload) =>
    setAttachments((a) =>
      a.some((x) => x.url === u.url)
        ? a.filter((x) => x.url !== u.url)
        : a.length >= 6
          ? a
          : [...a, { id: u.id, name: u.fileName, kind: u.kind === "image" ? "image" : u.kind === "pdf" ? "pdf" : "text", previewUrl: u.kind === "image" ? u.url : null, url: u.url, uploading: false }]
    );

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const picked = Array.from(files).slice(0, 6 - attachments.length);
    for (const file of picked) {
      const problem = validateAttachment(file);
      if (problem) {
        toast.error(problem);
        continue;
      }
      const kind = attachmentKind(file)!;
      const id = `${Date.now()}-${file.name}`;
      setAttachments((a) => [
        ...a,
        { id, name: file.name, kind, previewUrl: kind === "image" ? URL.createObjectURL(file) : null, url: null, uploading: true },
      ]);
      try {
        const res = await UploadsApi.upload(file, "attachment");
        setAttachments((a) => a.map((x) => (x.id === id ? { ...x, url: res.url, uploading: false } : x)));
        qc.invalidateQueries({ queryKey: ["uploads"] });
      } catch {
        setAttachments((a) => a.filter((x) => x.id !== id));
        toast.error(`Couldn't upload ${file.name}.`);
      }
    }
  };

  // Image 1 is the source photo (or the first attachment); every other attached image follows in order.
  const referenceImages = [
    ...(source?.kind !== "describe" && source?.imageUrl ? [source.imageUrl] : []),
    ...attachments.filter((a) => a.kind === "image" && a.url).map((a) => a.url!),
  ].filter((u, i, all) => all.indexOf(u) === i);
  const photosIgnored = referenceImages.length > 0 && !modelUsesPhotos(model);

  const generate = useMutation({
    mutationFn: () => {
      const text = prompt.trim();
      const firstSentence = text.split(/[.!\n]/)[0]?.slice(0, 120);
      const hostName = source?.productUrl ? source.productUrl.replace(/^https?:\/\/(www\.)?/, "").split(/[/?#]/)[0] : null;
      const imported = source?.kind === "url" ? source.product ?? null : null;
      const name =
        product?.name ??
        imported?.title ??
        promptTitle ??
        (text ? text.split(/\s+/).slice(0, 4).join(" ") : null) ??
        hostName ??
        (brandKit?.brandName || "New ad");
      const brief: Brief = {
        productName: name,
        productUrl: source?.kind === "url" ? source.productUrl ?? null : null,
        productDescription:
          [text, imported?.description, imported?.price ? `Price: ${formatPrice(imported.price, imported.currency)}` : null]
            .filter(Boolean)
            .join("\n\n") || product?.notes || null,
        targetAudience: "General consumers",
        targetMarket: DEFAULT_MARKET,
        language: DEFAULT_LANGUAGE,
        tone: brandKit?.tone || "Bold & punchy",
        offer: null,
        keyBenefit: firstSentence || `Why ${name} wins`,
        callToAction: brandKit?.defaultCta || "Shop now",
        referenceCreativeUrl: referenceImages[0] ?? null,
        referenceImageUrls: referenceImages.slice(1),
        // PDFs / text: read by an LLM first; only its notes reach the image or video prompt.
        documentUrls: attachments.filter((a) => (a.kind === "pdf" || a.kind === "text") && a.url).map((a) => a.url!),
        requiredText: null,
        prohibitedClaims: null,
      };
      return GenerationsApi.create({
        platform: ratio.platform,
        placement: ratio.placement,
        creativeType: mode as CreativeType,
        brief,
        conceptCount: effectiveCount,
        quality,
        model: model.id,
        durationSeconds: mode === "video" ? duration : null,
        productId,
        brandKitId,
        templateId,
      });
    },
    onSuccess: (gen) => router.push(`/generations/${gen.id}`),
    onError: (err) => {
      const { status, message, retryAfterSeconds } = apiError(err);
      if (status === 429) {
        toast.error(message, {
          description: retryAfterSeconds ? `Try again in ${Math.ceil(retryAfterSeconds / 60)} min.` : undefined,
        });
      } else {
        toast.error(message);
      }
    },
  });

  const submit = () => canGenerate && !generate.isPending && generate.mutate();

  const defaultPlaceholder =
    mode === "image"
      ? "Describe your product and the ad… e.g. “vitamin C serum, 20% off launch, clean bathroom shelf, bold headline”."
      : "Describe the video ad… the product, the hook, what happens in the first 3 seconds.";

  return (
    <div
      className={cn(
        "ring-neon rounded-2xl bg-card/80 p-4 shadow-[0_30px_80px_-40px_hsl(var(--iris)/0.6)] backdrop-blur-xl sm:p-5",
        className
      )}
    >
      {/* Attachments + product */}
      {(attachments.length > 0 || product) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {product && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-iris/15 px-3 py-1.5 text-xs font-semibold text-iris">
              <Package className="h-3.5 w-3.5" /> {product.name}
              <button type="button" aria-label="Remove product" onClick={() => setProductId(null)} className="ml-0.5 opacity-70 hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {attachments.map((a) => (
            <span
              key={a.id}
              title={a.name}
              className={cn(
                "relative overflow-hidden rounded-xl border border-border",
                a.previewUrl ? "h-14 w-14" : "flex h-14 w-36 items-center gap-2 bg-secondary/60 px-3 pr-6"
              )}
            >
              {a.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.previewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <>
                  <FileText className={cn("h-5 w-5 shrink-0", a.kind === "pdf" ? "text-flame" : "text-iris")} />
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-semibold">{a.name}</span>
                    <span className="font-mono text-[9px] uppercase text-muted-foreground">{a.kind}</span>
                  </span>
                </>
              )}
              {a.uploading ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                </span>
              ) : (
                <button
                  type="button"
                  aria-label="Remove attachment"
                  onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        // Grows with the text (an AI-written prompt is a paragraph), up to about 10 lines.
        rows={Math.min(10, Math.max(3, prompt.split(/\r?\n/).reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 72)), 0)))}
        placeholder={placeholder ?? defaultPlaceholder}
        maxLength={4000}
        className="w-full resize-none bg-transparent px-1 font-sans text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 sm:text-lg"
        aria-label="Ad prompt"
      />

      {/* Several photos to edit one by one: one prompt here makes one image from all of them. Flows edits each. */}
      {attachments.filter((a) => a.kind === "image" && a.url).length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-iris/40 bg-iris/10 px-3 py-2 text-xs">
          <WandSparkles className="h-3.5 w-3.5 shrink-0 text-iris" />
          <span className="min-w-0 flex-1">
            {attachments.filter((a) => a.kind === "image" && a.url).length} photos attached. Here they make one image together — to edit each photo
            into its own image, use Flows.
          </span>
          <Link
            href={`/flows?compose=${encodeURIComponent(prompt.trim().slice(0, 1500))}&photos=${encodeURIComponent(
              attachments.filter((a) => a.kind === "image" && a.url).slice(0, 6).map((a) => a.url).join(",")
            )}`}
            className="font-bold text-foreground underline underline-offset-2"
          >
            Edit each in Flows
          </Link>
        </div>
      )}

      {/* Asking for several different images in one prompt makes one collage: Flows makes each on its own. */}
      {wantsSeveral(prompt) > 0 && mode === "image" && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-iris/40 bg-iris/10 px-3 py-2 text-xs">
          <WandSparkles className="h-3.5 w-3.5 shrink-0 text-iris" />
          <span className="min-w-0 flex-1">
            Want {wantsSeveral(prompt)} different images? Flows makes each one on its own. Here, one prompt makes {effectiveCount === 1 ? "one image" : `${effectiveCount} takes on one idea`}.
          </span>
          <Link href={`/flows?compose=${encodeURIComponent(prompt.trim().slice(0, 2000))}`} className="font-bold text-foreground underline underline-offset-2">
            Make them as a flow
          </Link>
        </div>
      )}

      {/* Prompt tools: saved prompts, AI rewrite, save */}
      <div className="mb-1 flex flex-wrap items-center justify-end gap-1.5">
        {prompt.length > 3500 && (
          <span className={cn("mr-auto font-mono text-[10px]", prompt.length >= 4000 ? "text-flame" : "text-muted-foreground")}>
            {prompt.length.toLocaleString("en-US")} / 4,000
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <ScrollText className="h-3.5 w-3.5" /> Prompts
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="eyebrow">Saved prompts</DropdownMenuLabel>
            <div className="max-h-72 overflow-y-auto">
              {(savedPrompts.data ?? []).length === 0 && (
                <p className="px-2 py-2 text-xs text-muted-foreground">Nothing saved yet. Write a prompt and press Save.</p>
              )}
              {[...(savedPrompts.data ?? [])]
                .sort((a, b) => Number(b.kind === mode) - Number(a.kind === mode) || (a.groupId ?? "").localeCompare(b.groupId ?? "") || (a.position ?? 0) - (b.position ?? 0))
                .map((p, i, list) => (
                  <Fragment key={p.id}>
                  {p.groupId && p.groupId !== list[i - 1]?.groupId && (
                    <p className="px-2 pb-0.5 pt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {promptGroups.data?.find((g) => g.id === p.groupId)?.name ?? "Prompt set"}
                    </p>
                  )}
                  <DropdownMenuItem onClick={() => applyPrompt(p)} className="flex-col items-start gap-0.5">
                    <span className="flex w-full items-center gap-1.5">
                      {p.kind === "video" ? <Clapperboard className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ImageIcon className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <span className="truncate text-sm font-semibold">{p.title}</span>
                    </span>
                    <span className="line-clamp-1 text-[11px] text-muted-foreground">{p.text}</span>
                  </DropdownMenuItem>
                  </Fragment>
                ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/prompts"><ScrollText className="mr-2 h-3.5 w-3.5" /> Manage prompts</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={() => setSavingPrompt(true)}
          disabled={!prompt.trim()}
          className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          title="Save this prompt to reuse it"
        >
          <Bookmark className="h-3.5 w-3.5" /> Save
        </button>
        <PromptModelPicker ai={writer.ai} value={writer.model?.id} onChange={writer.choose} />
        <button
          type="button"
          onClick={() =>
            improve.mutate({
              idea: prompt,
              mode,
              aspectRatio: ratio.ratio,
              platform: ratio.platform,
              model: model.id,
              durationSeconds: mode === "video" ? duration : null,
              productName: product?.name ?? source?.product?.title ?? null,
              hasProductPhoto: hasImage,
              brandKitId,
              textModel: writer.model?.id,
            })
          }
          disabled={prompt.trim().length < 3 || prompt.length > 2000 || improve.isPending}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-iris/50 bg-iris/10 px-2.5 text-xs font-bold text-foreground transition-colors hover:bg-iris/20 disabled:pointer-events-none disabled:opacity-40"
          title={prompt.length > 2000 ? "Improve works on up to 2,000 characters" : `Rewrite it the way ${mode} models follow best`}
        >
          {improve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5 text-iris" />}
          Improve with AI
        </button>
      </div>

      {/* Controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Mode */}
        <div className="flex rounded-full border border-border bg-secondary/60 p-1">
          {(["image", "video"] as const).map((m) => {
            const Icon = m === "image" ? ImageIcon : Clapperboard;
            return (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold capitalize transition-all",
                  mode === m ? "bg-primary text-primary-foreground glow-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {m}
              </button>
            );
          })}
        </div>

        {/* Size */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Pill aria-label="Aspect ratio">
              <span className="block h-3.5 rounded-[3px] border-[1.5px] border-current" style={{ aspectRatio: ratioCss(ratio.ratio) }} />
              {ratio.ratio}
            </Pill>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel className="eyebrow">Size</DropdownMenuLabel>
            {RATIOS[mode].map((r) => (
              <DropdownMenuItem key={r.ratio} onClick={() => setRatio(r)} className="gap-2.5">
                <span className="block h-4 rounded-[3px] border-[1.5px] border-current" style={{ aspectRatio: ratioCss(r.ratio) }} />
                <span className="font-mono text-xs">{r.ratio}</span>
                <span className="text-xs text-muted-foreground">{r.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Model */}
        <ModelPicker
          models={catalog.models[mode]}
          value={model}
          quality={quality}
          onChange={(m) => pickModel(mode, m.id)}
          defaultId={defaultModelId(catalog, mode)}
          triggerClassName={PILL}
        />

        {/* Length (video) */}
        {mode === "video" && <DurationPicker model={model} quality={quality} value={duration} onChange={setSeconds} triggerClassName={PILL} />}

        {/* Quality: 2K images / 1080p video */}
        <Pill
          onClick={() => setQuality((q) => (q === "standard" ? "high" : "standard"))}
          className={cn(quality === "high" && "border-flame/60 text-flame")}
          aria-label="Quality"
          title={mode === "image" ? "High = 2K / extra detail" : "1080p (720p standard)"}
        >
          <Gem className="h-3.5 w-3.5" />
          {mode === "image" ? (quality === "high" ? "High" : "Standard") : quality === "high" ? "1080p" : "720p"}
        </Pill>

        {/* Count */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Pill aria-label="Number of concepts">
              <SlidersHorizontal className="h-3.5 w-3.5" /> ×{effectiveCount}
            </Pill>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuLabel className="eyebrow">Concepts</DropdownMenuLabel>
            {Array.from({ length: maxCount }, (_, i) => i + 1).map((n) => (
              <DropdownMenuItem key={n} onClick={() => setCount(n)}>
                <span className="font-mono text-xs">×{n}</span>
                <span className="ml-auto text-xs text-muted-foreground">{n === 1 ? "concept" : "concepts"}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Brand kit */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Pill aria-label="Brand kit" className={cn(brandKit && "border-iris/50")}>
              {brandKit ? (
                <span className="flex -space-x-1">
                  {brandKit.colors.slice(0, 3).map((c, i) => (
                    <span key={i} className="h-3 w-3 rounded-full border border-card" style={{ background: c }} />
                  ))}
                </span>
              ) : (
                <Palette className="h-3.5 w-3.5" />
              )}
              <span className="max-w-[9rem] truncate">{brandKit ? brandKit.brandName || "Brand kit" : "No brand kit"}</span>
            </Pill>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel className="eyebrow">Brand kit</DropdownMenuLabel>
            {(brandKits.data ?? []).map((k) => {
              const id = k.id ?? "primary";
              return (
                <DropdownMenuItem key={id} onClick={() => setBrandKitId(id)} className="gap-2.5">
                  <span className="flex -space-x-1">
                    {k.colors.slice(0, 3).map((c, i) => (
                      <span key={i} className="h-3.5 w-3.5 rounded-full border border-popover" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="truncate">{k.brandName || "Untitled brand"}</span>
                  {brandKitId === id && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuItem onClick={() => setBrandKitId("none")} className="gap-2.5">
              <Palette className="h-3.5 w-3.5 text-muted-foreground" /> No brand kit
              {brandKitId === "none" && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setKitEditor({ open: true, kit: null })} className="gap-2.5 font-semibold">
              <Plus className="h-3.5 w-3.5" /> New brand kit
            </DropdownMenuItem>
            {brandKit && (
              <DropdownMenuItem onClick={() => setKitEditor({ open: true, kit: brandKit })} className="gap-2.5 text-muted-foreground">
                <Pencil className="h-3.5 w-3.5" /> Edit {brandKit.brandName || "brand kit"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Product */}
        {(products.data?.length ?? 0) > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Pill aria-label="Use a product">
                <Package className="h-3.5 w-3.5" /> {product ? "Product" : "Add product"}
              </Pill>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="eyebrow">Your products</DropdownMenuLabel>
              {products.data!.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => setProductId(p.id)}>
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Attach: upload new, or reuse earlier uploads */}
        <Popover open={attachOpen} onOpenChange={setAttachOpen}>
          <PopoverTrigger asChild>
            <Pill aria-label="Attach images, PDF or text" title={ATTACHMENT_HINT}>
              <Paperclip className="h-3.5 w-3.5" /> Attach
              {attachments.length > 0 && <span className="font-mono text-[10px] opacity-70">{attachments.length}</span>}
            </Pill>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-3">
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={attachments.length >= 6}
              onClick={() => {
                setAttachOpen(false);
                fileRef.current?.click();
              }}
            >
              <Paperclip className="mr-1.5 h-3.5 w-3.5" /> Upload from computer
            </Button>
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">{ATTACHMENT_HINT} · up to 6</p>
            <LibraryPicker
              className="mt-3"
              selectedUrls={attachments.map((a) => a.url ?? "")}
              onToggle={toggleFromLibrary}
              canAddMore={attachments.length < 6}
            />
          </PopoverContent>
        </Popover>
        <input
          ref={fileRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          className="sr-only"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <div className="ml-auto flex items-center gap-2">
          {model.configured === false && (
            <Link href="/settings?tab=system" className="text-xs font-semibold text-honey hover:underline" title="Add its API key to use this model">
              {model.name} has no API key
            </Link>
          )}
          {photosIgnored && !needsPhoto && (
            <button
              type="button"
              onClick={() => pickModel(mode, mode === "image" ? defaultModelId(catalog, "image") : "omnihuman")}
              className="text-xs font-semibold text-honey hover:underline"
              title="This model only reads your prompt"
            >
              {model.name} ignores attached photos — {mode === "image" ? "use Nano Banana Pro" : "use OmniHuman"}
            </button>
          )}
          {needsPhoto && (
            <button type="button" onClick={() => fileRef.current?.click()} className="text-xs font-semibold text-honey hover:underline">
              {model.name} needs a photo — attach one
            </button>
          )}
          <Button size="lg" onClick={submit} disabled={!canGenerate || generate.isPending} className="h-11 px-5">
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            Generate
            <span className="rounded-full bg-primary-foreground/15 px-2 py-0.5 font-mono text-[10px]" title="Estimated cost at your AI provider's list price">
              ≈ {usd(totalCost)}
            </span>
          </Button>
        </div>
      </div>

      <PromptEditorDialog
        open={savingPrompt}
        onOpenChange={setSavingPrompt}
        initial={{ text: prompt, kind: mode, title: promptTitle ?? undefined }}
      />
      <BrandKitEditor
        open={kitEditor.open}
        onOpenChange={(open) => setKitEditor((s) => ({ ...s, open }))}
        kit={kitEditor.kit}
        onSaved={(kit) => setBrandKitId(kit.id ?? "primary")}
      />
    </div>
  );
}
