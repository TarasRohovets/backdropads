"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Flame, Link2, Loader2, Upload } from "lucide-react";
import type { Platform } from "@/models";
import { PLATFORMS } from "@/lib/taxonomy";
import { RoastsApi } from "@/api/roasts.api";
import { apiError } from "@/api/client";
import { AdsApi } from "@/api/ads.api";
import { UploadsApi } from "@/api/uploads.api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreativePreview } from "@/components/creative/CreativePreview";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_LANGUAGE, DEFAULT_MARKET, LANGUAGES, MARKETS } from "@/lib/locales";

function AnalyzeForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();

  const [tab, setTab] = useState<string>("upload");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [targetMarket, setTargetMarket] = useState(DEFAULT_MARKET);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [sourceUrl, setSourceUrl] = useState("");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [adId, setAdId] = useState<string | null>(null);

  const ads = useQuery({ queryKey: ["ads"], queryFn: () => AdsApi.list() });

  // Prefill when arriving via "Analyze this ad"
  useEffect(() => {
    const qAd = params.get("adId");
    const qPlatform = params.get("platform") as Platform | null;
    if (qAd) {
      setAdId(qAd);
      setTab("myads");
    }
    if (qPlatform && PLATFORMS.some((p) => p.id === qPlatform)) setPlatform(qPlatform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canAnalyze =
    (tab === "upload" && !!uploadedUrl) ||
    (tab === "url" && sourceUrl.trim().length > 8) ||
    (tab === "myads" && !!adId);

  const analyze = useMutation({
    mutationFn: () =>
      RoastsApi.create({
        adId: tab === "myads" ? adId : null,
        sourceUrl: tab === "url" ? sourceUrl : tab === "upload" ? uploadedUrl : null,
        platform,
        targetMarket,
        language,
      }),
    onSuccess: (roast) => router.push(`/analyses/${roast.id}`),
    onError: (err) => {
      const { status, message, retryAfterSeconds } = apiError(err);
      if (status === 429) {
        toast.error(message, { description: retryAfterSeconds ? `Try again in ${Math.ceil(retryAfterSeconds / 60)} min.` : undefined });
      } else {
        toast.error(message);
      }
    },
  });

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const res = await UploadsApi.upload(file, "ad");
      setUploadedUrl(res.url);
      toast.success("Creative uploaded");
    } catch {
      toast.error("Upload failed. Is the API running?");
    } finally {
      setUploading(false);
    }
  };

  const selectedAd = ads.data?.find((a) => a.id === adId);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="eyebrow mb-2 text-flame/90">Analyze</p>
      <h1 className="font-display text-3xl font-bold">Bring an ad. Leave with a better one.</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
        We score it on six dimensions, tell you exactly what's holding it back — and then help you rebuild it.
      </p>

      <div className="mt-8 rounded-xl border border-border bg-card p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-5 grid w-full grid-cols-3">
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="url">Paste ad URL</TabsTrigger>
            <TabsTrigger value="myads">From My Ads</TabsTrigger>
          </TabsList>

          <TabsContent value="upload">
            <label
              className={cn(
                "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm transition-colors",
                uploadedUrl
                  ? "border-mint/50 bg-mint-soft text-foreground"
                  : "border-border text-muted-foreground hover:border-flame/50 hover:text-foreground"
              )}
            >
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
              {uploading
                ? "Uploading…"
                : uploadedUrl
                  ? "Creative ready — you can analyze it now"
                  : "Drop an image, video or carousel export here, or click to browse"}
              <input
                type="file"
                accept="image/*,video/*"
                className="sr-only"
                onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
              />
            </label>
          </TabsContent>

          <TabsContent value="url">
            <Label htmlFor="adUrl">Meta or TikTok ad URL</Label>
            <div className="relative mt-1.5">
              <Link2 className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="adUrl"
                placeholder="https://www.facebook.com/ads/library/…"
                className="pl-9"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Works with Meta Ad Library and TikTok Creative Center links.
            </p>
          </TabsContent>

          <TabsContent value="myads">
            {ads.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (ads.data?.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No saved ads yet — create one first, then analyze it.
              </p>
            ) : (
              <div className="grid max-h-72 grid-cols-3 gap-3 overflow-y-auto scrollbar-thin pr-1 sm:grid-cols-4">
                {ads.data!.map((ad) => (
                  <button
                    key={ad.id}
                    type="button"
                    onClick={() => {
                      setAdId(ad.id);
                      setPlatform(ad.platform);
                    }}
                    className={cn(
                      "rounded-md border p-1.5 text-left transition-all",
                      adId === ad.id ? "border-flame ring-1 ring-flame/50" : "border-border hover:border-muted-foreground/40"
                    )}
                  >
                    <CreativePreview
                      creativeType="image"
                      ratio={ad.aspectRatio}
                      imageSeed={ad.imageSeed}
                      palette={ad.palette}
                      hook={ad.hook}
                      size="sm"
                      showRatio={false}
                      marks={false}
                    />
                    <span className="mt-1.5 block truncate text-[11px] font-medium">{ad.name}</span>
                  </button>
                ))}
              </div>
            )}
            {selectedAd && (
              <p className="mt-3 text-xs text-muted-foreground">
                Selected: <span className="font-medium text-foreground">{selectedAd.name}</span>
              </p>
            )}
          </TabsContent>
        </Tabs>

        <div className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-3">
          <div>
            <Label>Platform</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    platform === p.id
                      ? "border-flame bg-flame-soft text-foreground"
                      : "border-border text-muted-foreground hover:border-muted-foreground/50"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Target market</Label>
            <Select value={targetMarket} onValueChange={setTargetMarket}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {MARKETS.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Ad language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.label}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          size="lg"
          className="mt-6 w-full bg-flame text-flame-foreground hover:bg-flame/90"
          disabled={!canAnalyze || analyze.isPending}
          onClick={() => analyze.mutate()}
        >
          {analyze.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Flame className="mr-2 h-4 w-4" />}
          Analyze ad
        </Button>
      </div>
    </div>
  );
}

export default function AnalyzePage() {
  return (
    <Suspense>
      <AnalyzeForm />
    </Suspense>
  );
}
