"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, LibraryBig, Link2, Workflow } from "lucide-react";
import { RecentCreations } from "@/components/shared/RecentCreations";
import { PromptComposer } from "@/components/create/PromptComposer";
import { StarterStyles } from "@/components/flows/StarterStyles";
import { MassGenerationBanner } from "@/components/flows/MassGenerationBanner";
import { Button } from "@/components/ui/button";

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

const QUICK_STARTS = [
  { href: "/create", label: "From a product link", blurb: "Any product page", icon: Link2 },
  { href: "/flows", label: "Build a flow", blurb: "Reuse it for every product", icon: Workflow },
  { href: "/templates", label: "From a template", blurb: "Proven ad structures", icon: LibraryBig },
];

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      {/* Hero: the prompt is the product */}
      <motion.div {...fadeUp} transition={{ duration: 0.45 }} className="mx-auto max-w-3xl text-center">
        <p className="eyebrow mb-3">Studio</p>
        <h1 className="font-display text-3xl font-bold leading-[1.1] sm:text-5xl">
          What are we <span className="text-neon">selling today?</span>
        </h1>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          Describe your product or attach a photo and get a ready-to-post ad.
        </p>
      </motion.div>

      <motion.div {...fadeUp} transition={{ duration: 0.45, delay: 0.08 }} className="mx-auto mt-8 max-w-3xl">
        {/* Many ads at once → Flows */}
        <MassGenerationBanner />
        <PromptComposer />
      </motion.div>

      {/* Other ways in */}
      <motion.div
        {...fadeUp}
        transition={{ duration: 0.45, delay: 0.16 }}
        className="mx-auto mt-5 grid max-w-3xl gap-3 sm:grid-cols-3"
      >
        {QUICK_STARTS.map((q) => {
          const Icon = q.icon;
          return (
            <Link
              key={q.href}
              href={q.href}
              className="card-hover group flex items-center gap-3 rounded-2xl border border-border bg-card/60 px-4 py-3 backdrop-blur-sm"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-iris/15 text-iris">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{q.label}</span>
                <span className="block text-xs text-muted-foreground">{q.blurb}</span>
              </span>
              <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          );
        })}
      </motion.div>

      <StarterStyles />

      {/* Recent creations */}
      <section className="mt-16 pb-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="eyebrow mb-1">Library</p>
            <h2 className="font-display text-xl font-bold">Recent creations</h2>
          </div>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href="/history">
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        <RecentCreations />
      </section>
    </div>
  );
}
