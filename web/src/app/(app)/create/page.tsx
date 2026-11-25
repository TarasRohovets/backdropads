"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { AlertCircle, Check, Image as ImageIcon, Link2, Loader2, PenLine, ShoppingBag, Upload as UploadIcon, X } from "lucide-react";
import { UploadsApi, type Upload } from "@/api/uploads.api";
import { UploadsPicker } from "@/components/uploads/UploadsPicker";
import { ProductsApi, type ProductImport } from "@/api/products.api";
import { apiError } from "@/api/client";
import { TemplatesApi } from "@/api/templates.api";
import { PromptsApi } from "@/api/prompts.api";
import { PromptComposer, formatPrice, type ComposerSource } from "@/components/create/PromptComposer";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Kind = ComposerSource["kind"];

const SOURCES: { id: Kind; label: string; blurb: string; icon: React.ElementType }[] = [
  { id: "url", label: "Product link", blurb: "Shopify, WooCommerce or any store", icon: Link2 },
  { id: "image", label: "Product photo", blurb: "Or an ad you want to remix", icon: ImageIcon },
  { id: "describe", label: "Describe it", blurb: "No link or photo yet", icon: PenLine },
];

const PLACEHOLDERS: Record<Kind, string> = {
  image: "Add context… who it's for, the offer, the angle — e.g. “summer sale, 20% off, beach vibe”.",
  url: "Add context… the offer, the audience, the angle — e.g. “gift for runners, free shipping”.",
  describe: "Describe your product and the ad… what it is, who it's for, the offer, the mood.",
};

const PLATFORM_LABEL: Record<ProductImport["platform"], string> = {
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  generic: "Product page",
};

/** Debounce the typed link so we read the page once the user stops typing. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const isUrl = (v: string) => /^https?:\/\/[^\s.]+\.[^\s]+/.test(v.trim());

function CreatePage() {
  const params = useSearchParams();
  // Deep link: /create?url=https://store.com/products/…
  const initialUrl = params.get("url") ?? "";
  // Deep link from Uploads: /create?uploadId=upl_… starts from that photo.
  const uploadId = params.get("uploadId");
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>(uploadId ? "image" : "url");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState(initialUrl);
  const [heroIndex, setHeroIndex] = useState(0);

  const debouncedUrl = useDebounced(url.trim(), 700);
  const imported = useQuery({
    queryKey: ["product-import", debouncedUrl],
    queryFn: () => ProductsApi.importUrl(debouncedUrl),
    enabled: kind === "url" && isUrl(debouncedUrl),
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
  useEffect(() => setHeroIndex(0), [debouncedUrl]);
  const product = kind === "url" && isUrl(url) ? imported.data ?? null : null;
  const importing = kind === "url" && isUrl(url) && (url.trim() !== debouncedUrl || imported.isFetching);

  // Deep links: /create?productId=… (from Brand Kit) and /create?templateId=… (from Templates).
  const productId = params.get("productId");
  const templateId = params.get("templateId");
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => TemplatesApi.list(), enabled: !!templateId });
  const template = templates.data?.find((t) => t.id === templateId);
  // Deep link from Prompts: /create?promptId=prm_… starts from a saved prompt.
  const promptId = params.get("promptId");
  const savedPrompts = useQuery({ queryKey: ["prompts"], queryFn: () => PromptsApi.list(), enabled: !!promptId });
  const savedPrompt = savedPrompts.data?.find((p) => p.id === promptId) ?? null;
  useEffect(() => {
    if (savedPrompt) setKind("describe");
  }, [savedPrompt]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setImagePreview(URL.createObjectURL(file));
    try {
      const res = await UploadsApi.upload(file);
      setImageUrl(res.url);
      qc.invalidateQueries({ queryKey: ["uploads"] });
    } catch {
      setImagePreview(null);
      toast.error("Upload failed. Is the API running?");
    } finally {
      setUploading(false);
    }
  };

  const pickUpload = (upload: Upload) => {
    setImageUrl(upload.url);
    setImagePreview(upload.url);
  };

  const fromUpload = useQuery({ queryKey: ["upload", uploadId], queryFn: () => UploadsApi.get(uploadId!), enabled: !!uploadId });
  useEffect(() => {
    if (fromUpload.data) {
      setKind("image");
      pickUpload(fromUpload.data);
    }
  }, [fromUpload.data]);

  const source: ComposerSource = {
    kind,
    imageUrl: kind === "url" ? product?.images[heroIndex] ?? null : imageUrl,
    productUrl: kind === "url" ? url.trim() : null,
    product: product
      ? { title: product.title, description: product.description, brand: product.brand, price: product.price, currency: product.currency }
      : null,
    ready: kind === "image" ? !!imageUrl && !uploading : kind === "url" ? isUrl(url) && !importing : true,
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="text-center">
        <p className="eyebrow mb-2">Create</p>
        <h1 className="font-display text-3xl font-bold sm:text-4xl">
          Turn a product into <span className="text-neon">ads</span>
        </h1>
        {template && (
          <p className="mt-2 text-sm text-muted-foreground">
            Template: <span className="font-semibold text-foreground">{template.name}</span>
          </p>
        )}
      </div>

      {/* 1 — Start from */}
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {SOURCES.map((s) => {
          const Icon = s.icon;
          const selected = kind === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setKind(s.id)}
              className={cn(
                "card-hover flex items-center gap-3 rounded-2xl border bg-card/60 p-4 text-left backdrop-blur-sm sm:flex-col sm:items-start",
                selected ? "border-primary/70 shadow-[0_0_0_1px_hsl(var(--primary)/0.4)]" : "border-border"
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                  selected ? "bg-primary text-primary-foreground glow-primary" : "bg-secondary text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-bold">{s.label}</span>
                <span className="block text-xs text-muted-foreground">{s.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Source input */}
      <AnimatePresence mode="wait">
        {kind !== "describe" && (
          <motion.div
            key={kind}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="mt-4"
          >
            {kind === "image" &&
              (imagePreview ? (
                <div className="flex items-center gap-4 rounded-2xl border border-border bg-card/60 p-3">
                  <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imagePreview} alt="Source" className="h-full w-full object-cover" />
                    {uploading && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Loader2 className="h-5 w-5 animate-spin text-white" />
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{uploading ? "Uploading…" : "Image ready"}</p>
                    <p className="text-xs text-muted-foreground">We'll build the ad from this. Add context below.</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() => {
                      setImageUrl(null);
                      setImagePreview(null);
                    }}
                    className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/40 px-4 py-8 text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground">
                    <UploadIcon className="h-5 w-5" />
                    Drop an image here, or click to browse
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                    />
                  </label>
                  <UploadsPicker onPick={pickUpload} selectedUrl={imageUrl} />
                </div>
              ))}

            {kind === "url" && (
              <div className="space-y-3">
                <div className="relative">
                  <Link2 className="absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    autoFocus
                    placeholder="https://yourstore.com/products/…"
                    className="h-12 rounded-2xl pl-10 pr-10"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    aria-label="Product page URL"
                  />
                  {importing && <Loader2 className="absolute right-4 top-4 h-4 w-4 animate-spin text-muted-foreground" />}
                </div>

                {importing && !product && (
                  <p className="px-1 text-xs text-muted-foreground">Reading the product page…</p>
                )}

                {product && !importing && (
                  <div className="flex gap-4 rounded-2xl border border-border bg-card/60 p-3">
                    <span className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-secondary">
                      {product.images[heroIndex] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.images[heroIndex]} alt={product.title} className="h-full w-full object-cover" />
                      ) : (
                        <ShoppingBag className="absolute inset-0 m-auto h-6 w-6 text-muted-foreground" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-full bg-mint/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-mint">
                          <Check className="h-3 w-3" /> {PLATFORM_LABEL[product.platform]}
                        </span>
                        {product.brand && <span className="text-[11px] text-muted-foreground">{product.brand}</span>}
                      </p>
                      <p className="mt-1 truncate text-sm font-bold">{product.title}</p>
                      {product.price && (
                        <p className="font-mono text-xs text-muted-foreground">{formatPrice(product.price, product.currency)}</p>
                      )}
                      {product.images.length > 1 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {product.images.map((src, i) => (
                            <button
                              key={src}
                              type="button"
                              onClick={() => setHeroIndex(i)}
                              aria-label={`Use photo ${i + 1}`}
                              className={cn(
                                "h-9 w-9 overflow-hidden rounded-lg border-2 transition-colors",
                                i === heroIndex ? "border-primary" : "border-transparent opacity-70 hover:opacity-100"
                              )}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={src} alt="" className="h-full w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {product.images.length > 1
                          ? "Pick the photo to build the ads around. We use the product copy too."
                          : "We build the ads around this photo and the product copy."}
                      </p>
                    </div>
                  </div>
                )}

                {imported.isError && !importing && isUrl(url) && (
                  <div className="flex items-start gap-3 rounded-2xl border border-honey/40 bg-honey/10 p-3 text-xs">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-honey" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{apiError(imported.error).message}</p>
                      <p className="mt-0.5 text-muted-foreground">
                        You can still generate from the link and your notes, or{" "}
                        <button type="button" onClick={() => setKind("image")} className="font-semibold text-foreground underline underline-offset-2">
                          upload a product photo
                        </button>
                        .
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2 — Context + options (same composer as the dashboard) */}
      <div className="mt-6">
        <p className="eyebrow mb-2 px-1">{kind === "describe" ? "Your prompt" : "More context"}</p>
        <PromptComposer
          source={source}
          placeholder={PLACEHOLDERS[kind]}
          initialMode={template?.creativeType === "video" ? "video" : "image"}
          initialProductId={productId}
          templateId={templateId}
          initialPrompt={savedPrompt}
        />
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          {kind === "describe"
            ? "A couple of sentences is enough."
            : kind === "image"
              ? "Context is optional — the image does the heavy lifting."
              : "Context is optional — we read the product page for the title, price, copy and photos."}
        </p>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <CreatePage />
    </Suspense>
  );
}
