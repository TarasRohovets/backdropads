"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowRight, Copy, Flame, Loader2, Sparkles, WandSparkles } from "lucide-react";
import type { Roast } from "@/models";
import { RoastsApi } from "@/api/roasts.api";
import { apiError } from "@/api/client";
import { platformMeta } from "@/lib/taxonomy";
import { ScoreRing } from "@/components/roast/ScoreRing";
import { ScoreBar } from "@/components/roast/ScoreBar";
import { CreativeFrame } from "@/components/creative/CreativeFrame";
import { AdComposition } from "@/components/creative/AdComposition";
import { PlatformChip } from "@/components/shared/PlatformChip";
import { Button } from "@/components/ui/button";
import { seedImage } from "@/lib/taxonomy";
import { cn } from "@/lib/utils";

const STAGES = [
  "Reading the creative…",
  "Scoring the hook…",
  "Judging the offer…",
  "Checking platform fit…",
  "Writing the critique…",
];

function RoastProgress() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 1100);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <span className="absolute inset-0 animate-pulse-soft rounded-full bg-flame-soft" />
        <Flame className="h-10 w-10 text-flame" />
      </div>
      <div className="mt-8 h-6 text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={stage}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="text-sm font-medium"
          >
            {STAGES[stage]}
          </motion.p>
        </AnimatePresence>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Almost there — good feedback takes a moment.</p>
    </div>
  );
}

const DIMENSIONS: { key: keyof NonNullable<Roast["scores"]>; label: string }[] = [
  { key: "hook", label: "Hook" },
  { key: "visual", label: "Visual" },
  { key: "offer", label: "Offer" },
  { key: "message", label: "Message" },
  { key: "cta", label: "CTA" },
  { key: "platformFit", label: "Platform fit" },
];

export default function RoastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const roast = useQuery({
    queryKey: ["roast", id],
    queryFn: () => RoastsApi.get(id),
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 1300 : false),
  });

  const improve = useMutation({
    mutationFn: () => RoastsApi.improve(id),
    onSuccess: (gen) => router.push(`/generations/${gen.id}`),
    onError: (err) => toast.error(apiError(err).message),
  });

  const r = roast.data;

  if (roast.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (roast.isError || !r) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-display text-xl font-bold">Analysis not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">It may have expired, or the API isn't running.</p>
        <Button asChild className="mt-6" variant="outline">
          <Link href="/analyze">Analyze another ad</Link>
        </Button>
      </div>
    );
  }

  if (r.status === "processing") return <RoastProgress />;

  const meta = platformMeta(r.platform);
  const recommendations = [...(r.recommendations ?? [])].sort((a, b) => a.priority - b.priority);

  const copyRoast = () => {
    navigator.clipboard?.writeText(`${r.roastText}\n\n— analyzed by BackdropAds, score ${r.overallScore}/100`);
    toast.success("Critique copied.");
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      {/* Verdict */}
      <div className="flex flex-col items-start gap-8 md:flex-row md:items-center">
        <ScoreRing score={r.overallScore ?? 0} size={148} label="Overall" />
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-2 text-flame/90">The verdict</p>
          <h1 className="font-display text-3xl font-bold">
            {r.overallScore! >= 75
              ? "Solid ad. Let's make it unfair."
              : r.overallScore! >= 50
                ? "It has a pulse — barely."
                : "This ad needs an intervention."}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <PlatformChip platform={r.platform} />
            <span>{r.targetMarket}</span>
            <span>·</span>
            <span>{r.language}</span>
          </div>
        </div>
      </div>

      {/* Dimension scores */}
      <div className="mt-10 grid gap-x-10 gap-y-5 rounded-xl border border-border bg-card p-6 sm:grid-cols-2 lg:grid-cols-3">
        {DIMENSIONS.map((d, i) => (
          <ScoreBar key={d.key} label={d.label} score={r.scores?.[d.key] ?? 0} delay={i * 90} />
        ))}
      </div>

      {/* THE CRITIQUE */}
      <section className="mt-12">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="eyebrow mb-1 text-flame/90">The critique</p>
            <h2 className="font-display text-xl font-bold">Straight talk, no fluff.</h2>
          </div>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={copyRoast}>
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
          </Button>
        </div>
        <blockquote className="relative overflow-hidden rounded-lg border border-flame/30 bg-card p-7 sm:p-9">
          <Flame className="mb-4 h-6 w-6 text-flame" />
          <p className="whitespace-pre-line font-display text-lg font-medium leading-relaxed sm:text-xl">
            {r.roastText}
          </p>
          <footer className="mt-5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            BackdropAds · {meta.label} · {r.overallScore}/100
          </footer>
        </blockquote>
      </section>

      {/* WHAT TO FIX */}
      {recommendations.length > 0 && (
        <section className="mt-12">
          <p className="eyebrow mb-1">What to fix</p>
          <h2 className="mb-5 font-display text-xl font-bold">In this order.</h2>
          <ol className="space-y-3">
            {recommendations.map((rec) => (
              <li key={rec.id} className="flex gap-4 rounded-lg border border-border bg-card p-5">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold",
                    rec.priority === 1 ? "bg-flame-soft text-flame" : rec.priority === 2 ? "bg-honey-soft text-honey" : "bg-secondary text-muted-foreground"
                  )}
                >
                  {rec.priority}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{rec.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{rec.problem}</p>
                  <p className="mt-2 text-xs leading-relaxed text-foreground">{rec.recommendation}</p>
                  {rec.improvedText && (
                    <p className="mt-2 rounded-md bg-mint-soft px-3 py-2 text-xs font-medium text-mint">
                      Try: “{rec.improvedText}”
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* IMPROVED VERSION — before / after */}
      {r.improved && (
        <section className="mt-12 pb-10">
          <p className="eyebrow mb-1">Improved version</p>
          <h2 className="mb-6 font-display text-xl font-bold">Same product. New chances.</h2>
          <div className="grid items-start gap-8 sm:grid-cols-2">
            <div>
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Original</p>
              <CreativeFrame ratio="4:5" showRatio={false}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={seedImage(r.sourceImageSeed, 900, 1100)}
                  alt="Original ad"
                  className="absolute inset-0 h-full w-full object-cover opacity-80 saturate-50"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                <span className="absolute bottom-3 left-3 rounded bg-black/55 px-2 py-1 font-mono text-[10px] text-white/80 backdrop-blur-sm">
                  score {r.overallScore}
                </span>
              </CreativeFrame>
            </div>
            <div>
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-mint">Improved</p>
              <CreativeFrame ratio="4:5" showRatio={false}>
                <AdComposition
                  imageSeed={r.improved.imageSeed}
                  palette={r.improved.palette}
                  hook={r.improved.hook}
                  callToAction={r.improved.callToAction}
                  ratio="4:5"
                  size="md"
                />
                <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-mint/90 px-2 py-0.5 text-[10px] font-bold text-black">
                  <Sparkles className="h-3 w-3" /> Rebuilt
                </span>
              </CreativeFrame>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{r.improved.primaryText}</p>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center gap-3 rounded-xl border border-iris/30 bg-card p-8 text-center">
            <h3 className="font-display text-lg font-bold">Turn this critique into creatives</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              The full analysis — every weakness and fix — feeds straight into the brief. Nothing gets lost.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-3">
              <Button size="lg" onClick={() => improve.mutate()} disabled={improve.isPending}>
                {improve.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-2 h-4 w-4" />}
                Create improved ad
              </Button>
              <Button size="lg" variant="outline" onClick={() => improve.mutate()} disabled={improve.isPending}>
                Generate 3 variations <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
