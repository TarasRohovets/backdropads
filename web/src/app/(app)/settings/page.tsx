"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, CircleDashed, ExternalLink, Loader2, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import { SystemApi, type ModelCheckResult, type ModelStatus, type ModelUpdateResult, type SystemInfo } from "@/api/system.api";
import { apiError } from "@/api/client";
import { usd } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { WorkspacesTab } from "@/components/settings/WorkspacesTab";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ago = (iso: string | null | undefined) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "—");

/* ── System: API keys, models, usage ──────────────────────────────────────── */

function Pill({ tone, children }: { tone: "good" | "warn" | "bad" | "muted"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone === "good" && "bg-mint-soft text-mint",
        tone === "warn" && "bg-honey-soft text-honey",
        tone === "bad" && "bg-flame-soft text-flame",
        tone === "muted" && "bg-secondary text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

const STATUS: Record<ModelStatus, { label: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  available: { label: "Available", tone: "good" },
  unavailable: { label: "Not available", tone: "bad" },
  error: { label: "Check failed", tone: "bad" },
  unverified: { label: "Can't verify", tone: "warn" },
  notConfigured: { label: "No API key", tone: "muted" },
};

const KIND_LABEL = { image: "Image", video: "Video", edit: "Edit", voice: "Voice", text: "Text" } as const;

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SystemTab() {
  const qc = useQueryClient();
  const system = useQuery({ queryKey: ["system"], queryFn: () => SystemApi.get() });
  const check = useMutation({
    mutationFn: () => SystemApi.checkModels(),
    onSuccess: (report) => {
      qc.invalidateQueries({ queryKey: ["system"] });
      if (report.unavailable === 0) toast.success("Check complete: every checked model is available");
      else toast.error(`${report.unavailable} model${report.unavailable === 1 ? "" : "s"} need attention`);
    },
    onError: (e) => toast.error(apiError(e).message),
  });

  // "Update models": newest version of every model, straight from the providers.
  const [updated, setUpdated] = useState<ModelUpdateResult | null>(null);
  const refreshModels = () => {
    qc.invalidateQueries({ queryKey: ["system"] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
  };
  const update = useMutation({
    mutationFn: () => SystemApi.updateModels(),
    onSuccess: (result) => {
      setUpdated(result);
      refreshModels();
      if (result.changes.length > 0) toast.success(`${result.changes.length} model${result.changes.length === 1 ? "" : "s"} moved to a newer version`);
      else toast.success("Every model is already on its newest version");
    },
    onError: (e) => toast.error(apiError(e).message),
  });
  const reset = useMutation({
    mutationFn: () => SystemApi.resetModels(),
    onSuccess: () => {
      setUpdated(null);
      refreshModels();
      toast.success("Back to the built-in model versions");
    },
    onError: (e) => toast.error(apiError(e).message),
  });

  if (system.isLoading) return <Skeleton className="h-96 rounded-lg" />;
  const data = system.data as SystemInfo | undefined;
  if (!data) return null;

  const results = new Map<string, ModelCheckResult>((data.lastCheck?.results ?? []).map((r) => [r.id, r]));
  const usage = new Map(data.usage.map((u) => [u.id, u]));
  const problems = (data.lastCheck?.results ?? []).filter((r) => r.status === "unavailable" || r.status === "error");
  const t = data.totals;

  return (
    <div className="space-y-6">
      {/* Update models */}
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <p className="font-display text-base font-semibold">Keep your models current</p>
            <p className="mt-1 text-sm text-muted-foreground">
              AI providers release new versions and retire old ones. This asks each provider for its newest version of every
              model and switches to it. It&apos;s free: nothing is generated.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data.modelsUpdated && (
              <button
                type="button"
                disabled={reset.isPending || update.isPending}
                onClick={() => reset.mutate()}
                className="text-xs font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
              >
                Use built-in versions
              </button>
            )}
            <Button disabled={update.isPending || reset.isPending} onClick={() => update.mutate()}>
              {update.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
              Update models
            </Button>
          </div>
        </div>

        {updated && (
          <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            {updated.changes.length === 0 ? (
              <p className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-mint" />
                {updated.upToDate > 0 ? "Every model is already on its newest version." : "No models could be checked."}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {updated.changes.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-mint" />
                    <span className="font-semibold">{c.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{c.from}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-mono text-xs">{c.to}</span>
                  </li>
                ))}
              </ul>
            )}
            {updated.changes.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Cost estimates keep the previous version&apos;s price until you update the app. Not happy with a new version? Choose
                &ldquo;Use built-in versions&rdquo;.
              </p>
            )}
            {updated.skipped.map((s) => (
              <p key={s.provider} className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{s.provider}:</span> {s.reason}
              </p>
            ))}
          </div>
        )}
      </section>

      {data.mockMode && (
        <div className="rounded-lg border border-honey/40 bg-honey-soft p-4 text-sm">
          <p className="font-semibold">Demo mode is on</p>
          <p className="mt-1 text-muted-foreground">
            Results are placeholders and nothing is sent to an AI provider. Set <span className="font-mono">AI_USE_MOCK=false</span> in your{" "}
            <span className="font-mono">.env</span> and restart to generate for real.
          </p>
        </div>
      )}

      {/* Usage */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Images, 7 days" value={t.images7d.toLocaleString()} hint={`${t.images30d.toLocaleString()} in 30 days`} />
        <Stat label="Videos, 7 days" value={t.videos7d.toLocaleString()} hint={`${t.videos30d.toLocaleString()} in 30 days`} />
        <Stat label="Estimated cost, 7 days" value={`≈ ${usd(t.costUsd7d)}`} />
        <Stat label="Estimated cost, 30 days" value={`≈ ${usd(t.costUsd30d)}`} hint="At list prices. Your provider's invoice is the truth." />
      </div>

      {/* API keys */}
      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <p className="eyebrow">AI providers</p>
        </div>
        <ul className="divide-y divide-border">
          {data.providers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              {p.configured ? <CheckCircle2 className="h-4 w-4 shrink-0 text-mint" /> : <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.powers}</p>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">{p.envVars.join(" + ")}</span>
              {p.configured ? (
                <Pill tone="good">Key set</Pill>
              ) : (
                <a
                  href={p.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-foreground underline-offset-4 hover:underline"
                >
                  Get a key <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          Keys live in your <span className="font-mono">.env</span> file, never in the database or the browser. Add one, restart (
          <span className="font-mono">docker compose up -d</span>), and its models switch on. Files are stored in:{" "}
          <span className="font-semibold text-foreground">{data.storage === "azure" ? "Azure Blob Storage" : "a local folder"}</span>.
        </p>
      </section>

      {/* Models */}
      {problems.length > 0 && (
        <div className="flex gap-3 rounded-lg border border-flame/40 bg-flame-soft p-4 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-flame" />
          <div>
            <p className="font-semibold">
              {problems.map((p) => p.label).join(", ")} {problems.length === 1 ? "is" : "are"} not available.
            </p>
            <p className="mt-1 text-muted-foreground">
              Nothing was switched automatically. Choose &ldquo;Update models&rdquo; above to move to the newest versions.
            </p>
          </div>
        </div>
      )}

      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <p className="eyebrow">Models</p>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {data.lastCheck ? `Checked ${ago(data.lastCheck.checkedAt)} (${data.lastCheck.trigger})` : "Not checked yet"}
              {data.nextWeeklyCheckAfter && ` · next weekly run ${format(new Date(data.nextWeeklyCheckAfter), "d MMM")}`}
            </span>
            <Button size="sm" variant="outline" disabled={check.isPending} onClick={() => check.mutate()}>
              {check.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Check now
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Provider id</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right" title="Results produced by this model">Served 7d / 30d</TableHead>
                <TableHead className="text-right" title="Picked, but another model did the work or it failed">Fell back</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.models.map((m) => {
                const r = results.get(m.id);
                const u = usage.get(m.id);
                const status = r ? STATUS[r.status] : null;
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <p className="font-medium">{m.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {KIND_LABEL[m.kind]} · {m.provider}
                        {m.inAutoChain && " · in Auto chain"}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate font-mono text-xs text-muted-foreground" title={m.providerModelId}>
                      {m.providerModelId}
                    </TableCell>
                    <TableCell>
                      {status ? (
                        <div title={r?.detail}>
                          <Pill tone={status.tone}>{status.label}</Pill>
                          {r && r.status !== "available" && r.status !== "notConfigured" && (
                            <p className="mt-1 max-w-[18rem] text-xs text-muted-foreground">{r.detail}</p>
                          )}
                        </div>
                      ) : (
                        <Pill tone="muted">Not checked</Pill>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {u?.served7d ?? 0} / {u?.served30d ?? 0}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{u?.fellBack30d ?? 0}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          The check asks each provider whether its model ids still exist. It&apos;s free, runs weekly, and never switches a model. Auto
          tries, in order: images {data.chains.image.filter((c) => c !== "mock").join(" → ") || "—"} · video{" "}
          {data.chains.video.filter((c) => c !== "mock").join(" → ") || "—"}.
        </p>
      </section>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

function SettingsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") ?? "system";

  return (
    <div className={cn("mx-auto px-4 py-10 sm:px-6", tab === "system" ? "max-w-5xl" : "max-w-3xl")}>
      <p className="eyebrow mb-2">Instance</p>
      <h1 className="font-display text-3xl font-bold">Settings</h1>

      <Tabs value={tab} onValueChange={(v) => router.replace(`/settings?tab=${v}`)} className="mt-7 pb-10">
        <TabsList className="mb-6">
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
        </TabsList>
        <TabsContent value="system"><SystemTab /></TabsContent>
        <TabsContent value="workspaces"><WorkspacesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
