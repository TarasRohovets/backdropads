"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Images, Search } from "lucide-react";
import type { AdStatus, CreativeType, Platform } from "@/models";
import { AdsApi } from "@/api/ads.api";
import { ProductsApi } from "@/api/products.api";
import { PLATFORMS } from "@/lib/taxonomy";
import { AdCard } from "@/components/shared/AdCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TYPES: CreativeType[] = ["image", "video", "carousel"];
const STATUSES: AdStatus[] = ["ready", "draft"];

function MyAdsContent() {
  const params = useSearchParams();
  const [platform, setPlatform] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [product, setProduct] = useState<string>(params.get("productId") ?? "all");
  const [search, setSearch] = useState("");

  const ads = useQuery({ queryKey: ["ads"], queryFn: () => AdsApi.list() });
  const products = useQuery({ queryKey: ["products"], queryFn: () => ProductsApi.list() });

  const filtered = useMemo(() => {
    let list = ads.data ?? [];
    if (product !== "all") list = list.filter((a) => a.productId === product);
    if (platform !== "all") list = list.filter((a) => a.platform === platform);
    if (type !== "all") list = list.filter((a) => a.creativeType === type);
    if (status !== "all") list = list.filter((a) => a.status === status);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.hook.toLowerCase().includes(q));
    }
    return list;
  }, [ads.data, product, platform, type, status, search]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Library</p>
          <h1 className="font-display text-3xl font-bold">My Ads</h1>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {ads.data ? `${filtered.length} of ${ads.data.length}` : ""}
        </span>
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search ads…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Platform" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {PLATFORMS.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-32"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(products.data?.length ?? 0) > 0 && (
          <Select value={product} onValueChange={setProduct}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Product" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All products</SelectItem>
              {products.data!.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Grid */}
      {ads.isLoading ? (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={Images}
          title={ads.data?.length ? "Nothing matches those filters" : "No ads yet"}
          description={
            ads.data?.length
              ? "Try widening the platform, type or status filters."
              : "Everything you generate and save lives here."
          }
          actionLabel={ads.data?.length ? undefined : "Create your first ad"}
          actionHref={ads.data?.length ? undefined : "/create"}
        />
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 pb-10 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map((ad) => (
            <AdCard key={ad.id} ad={ad} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MyAdsPage() {
  return (
    <Suspense>
      <MyAdsContent />
    </Suspense>
  );
}
