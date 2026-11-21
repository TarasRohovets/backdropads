"use client";

import "@xyflow/react/dist/style.css";
import { useCatalog } from "@/hooks/use-catalog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, Check, Copy, Image as ImageIcon, Loader2, MessageSquarePlus, Play, RotateCcw } from "lucide-react";
import {
  applyRun,
  estimateCost,
  normalizeNode,
  outputStep,
  promptStep,
  runOrder,
  toSavable,
  uid,
  type FlowDoc,
  type FlowNode,
  type FlowBatch,
  type FlowRun,
  type OutputStepData,
  type PromptStepData,
  type StepData,
} from "@/lib/flows";
import { FlowsApi } from "@/api/flows.api";
import { usd } from "@/lib/catalog";
import { apiError } from "@/api/client";
import { FlowActions, nodeTypes } from "./FlowNodes";
import { FlowInspector } from "./FlowInspector";
import { BatchPanel, BatchRunButton } from "./BatchRun";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type RFNode = Node<Record<string, unknown>>;

const toRF = (n: FlowNode): RFNode => ({ id: n.id, type: n.type, position: n.position, data: n.data as unknown as Record<string, unknown> });
const fromRF = (n: RFNode): FlowNode => ({ id: n.id, type: n.type as FlowNode["type"], position: n.position, data: n.data as unknown as StepData });

const EDGE_COLOR = "#8B5CF6";
const edgeDefaults = {
  type: "smoothstep" as const,
  markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR, width: 18, height: 18 },
  style: { stroke: EDGE_COLOR, strokeWidth: 2 },
};

type SaveState = "saved" | "saving" | "error";

/** Horizontal spacing between chained cards. */
const COLUMN = 360;

/** Every card reachable downstream of `id`. */
function descendants(id: string, edges: Edge[]): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of edges) if (e.source === cur && !seen.has(e.target)) { seen.add(e.target); stack.push(e.target); }
  }
  return seen;
}

/** Nearest spot (scanning downward) where a new card doesn't overlap any existing one. */
function freeSpot(start: { x: number; y: number }, nodes: RFNode[]) {
  const W = 280;
  const H = 240;
  const overlaps = (p: { x: number; y: number }) =>
    nodes.some((n) => {
      const w = n.measured?.width ?? W;
      const h = n.measured?.height ?? 320;
      return p.x < n.position.x + w + 24 && p.x + W + 24 > n.position.x && p.y < n.position.y + h + 24 && p.y + H + 24 > n.position.y;
    });
  const p = { ...start };
  for (let i = 0; i < 40 && overlaps(p); i++) p.y += 60;
  return p;
}

function Board({ flow }: { flow: FlowDoc }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { resolvedTheme } = useTheme();
  const rf = useReactFlow();

  const initialNodes = useMemo(() => applyRun(flow.nodes.map(normalizeNode), flow.lastRun), [flow]);
  const [name, setName] = useState(flow.name);
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(initialNodes.map(toRF));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(flow.edges.map((e) => ({ ...e, ...edgeDefaults })));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [run, setRun] = useState<FlowRun | null>(flow.lastRun ?? null);
  const [batch, setBatch] = useState<FlowBatch | null>(flow.lastBatch ?? null);
  const batchRunning = batch?.status === "running";
  // Arrived from a ready-made style (?photos=1): the photo picker opens straight away.
  const [pickPhotos] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("photos") === "1");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [copying, setCopying] = useState(false);
  const running = run?.status === "running";

  const catalog = useCatalog();

  // ---- autosave to the API (debounced) --------------------------------------------------
  // The board is serialised only when a save is due — never on every drag frame.
  const latest = useRef({ name, nodes, edges });
  latest.current = { name, nodes, edges };
  const serialize = useCallback(() => {
    const s = latest.current;
    // Only author edits count — run results live in `data` but toSavable strips them.
    return JSON.stringify({
      name: s.name.trim() || "Untitled flow",
      nodes: s.nodes.map((n) => toSavable(fromRF(n))),
      edges: s.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    });
  }, []);
  const lastSaved = useRef<string | null>(null);
  if (lastSaved.current === null) lastSaved.current = serialize();

  const save = useCallback(async () => {
    const body = serialize();
    if (body === lastSaved.current) return;
    setSaveState("saving");
    try {
      await FlowsApi.update(flow.id, JSON.parse(body));
      lastSaved.current = body;
      setSaveState("saved");
      qc.invalidateQueries({ queryKey: ["flows"] });
    } catch (err) {
      setSaveState("error");
      toast.error(apiError(err).message);
    }
  }, [flow.id, qc, serialize]);

  // Leaving the board flushes edits that haven't hit the debounce yet.
  useEffect(() => () => void save(), [save]);

  // Save shortly after edits stop; while a card is being dragged, wait for the drop.
  const dragging = nodes.some((n) => n.dragging);
  useEffect(() => {
    if (dragging) return;
    const t = setTimeout(save, 700);
    return () => clearTimeout(t);
  }, [name, nodes, edges, dragging, save]);

  // ---- run polling (also resumes a run that was in progress on load) ---------------------
  useEffect(() => {
    if (!run || run.status !== "running") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await FlowsApi.getRun(flow.id, run.id);
        if (cancelled) return;
        setNodes((ns) => applyRun(ns.map(fromRF), next).map((n) => ({ ...toRF(n), selected: ns.find((x) => x.id === n.id)?.selected })));
        if (next.status === "running") {
          setTimeout(tick, 800);
        } else {
          setRun(next);
          setEdges((es) => es.map((e) => ({ ...e, animated: false })));
          qc.invalidateQueries({ queryKey: ["generations"] });
          if (next.status === "completed") toast.success("Flow finished", { description: "Open an output card to save its results to My Ads." });
          else toast.error(next.error ?? "The run failed.");
        }
      } catch {
        if (!cancelled) setTimeout(tick, 1500);
      }
    };
    setEdges((es) => es.map((e) => ({ ...e, animated: true })));
    tick();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.status, flow.id]);

  // ---- helpers -------------------------------------------------------------------------
  const structureKey = `${nodes.map((n) => `${n.id}:${n.type}`).join("|")}#${edges.map((e) => `${e.source}>${e.target}`).join("|")}`;
  const promptOrder = useMemo(() => {
    const { nodes: ns, edges: es } = latest.current;
    const order = runOrder(ns.map(fromRF), es.map((e) => ({ id: e.id, source: e.source, target: e.target })));
    const types = new Map(ns.map((n) => [n.id, n.type]));
    return order.filter((id) => types.get(id) === "prompt");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- structure only; positions don't change the order
  }, [structureKey]);
  const indexOf = useCallback((id: string) => Math.max(0, promptOrder.indexOf(id)), [promptOrder]);

  const patchNode = useCallback(
    (id: string, patch: Partial<PromptStepData> | Partial<OutputStepData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [setNodes]
  );

  const addNode = useCallback(
    (kind: "prompt" | "output", after?: string) => {
      const anchor = after ? nodes.find((n) => n.id === after) : undefined;
      const center = rf.screenToFlowPosition({ x: window.innerWidth / 2 - 140, y: window.innerHeight / 2 - 80 });
      const pos = anchor ? { x: anchor.position.x + COLUMN, y: anchor.position.y } : center;
      const created = kind === "prompt" ? promptStep(pos.x, pos.y, `Step ${promptOrder.length + 1}`) : outputStep(pos.x, pos.y);
      const node = toRF(created);

      setNodes((ns) => {
        let next = ns.map((n) => ({ ...n, selected: false }));
        if (anchor) {
          // Inserting into a chain: push everything downstream one column right to make room.
          const downstream = descendants(anchor.id, edges);
          next = next.map((n) => (downstream.has(n.id) ? { ...n, position: { x: n.position.x + COLUMN, y: n.position.y } } : n));
        } else {
          node.position = freeSpot(pos, next);
        }
        return [...next, { ...node, selected: true }];
      });

      if (anchor) {
        // Insert between the anchor and whatever it fed into (keeps the chain intact).
        setEdges((es) => {
          const outgoing = es.filter((e) => e.source === anchor.id);
          const rest = es.filter((e) => e.source !== anchor.id);
          const rewired = kind === "prompt" ? outgoing.map((e) => ({ ...e, id: uid("e"), source: node.id })) : outgoing;
          return [...rest, ...rewired, { id: uid("e"), source: anchor.id, target: node.id, ...edgeDefaults }];
        });
        // Re-frame so the shifted chain stays on screen.
        setTimeout(() => rf.fitView({ padding: 0.3, maxZoom: 1, duration: 300 }), 60);
      }
      setSelectedId(node.id);
    },
    [nodes, edges, promptOrder.length, rf, setEdges, setNodes]
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source === c.target) return;
      if (nodes.find((n) => n.id === c.source)?.type === "output") return; // outputs are the end of the line
      setEdges((es) => addEdge({ ...c, id: uid("e"), ...edgeDefaults }, es));
    },
    [nodes, setEdges]
  );

  const removeNode = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
  };

  const duplicateNode = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    const clean = toSavable(fromRF(n));
    const copy: RFNode = {
      ...toRF({ ...clean, id: uid(n.type === "output" ? "out" : "step"), position: { x: n.position.x + 40, y: n.position.y + 200 } }),
      selected: true,
    };
    copy.data = { ...copy.data, title: `${String(n.data.title ?? "")} copy` };
    setNodes((ns) => [...ns.map((x) => ({ ...x, selected: false })), copy]);
    setSelectedId(copy.id);
  };

  // ---- run on the server -----------------------------------------------------------------
  const cost = estimateCost(nodes.map(fromRF), catalog);

  const startRun = async () => {
    await save(); // run exactly what's on the board
    try {
      const started = await FlowsApi.run(flow.id);
      setNodes((ns) => applyRun(ns.map((n) => toSavable(fromRF(n))), started).map(toRF));
      setRun(started);
    } catch (err) {
      const { status, message, retryAfterSeconds } = apiError(err);
      if (status === 429) {
        toast.error(message, { description: retryAfterSeconds ? `Try again in ${Math.ceil(retryAfterSeconds / 60)} min.` : undefined });
      } else {
        toast.error(message);
        // Point at the problem card when the API says a step is empty.
        const empty = nodes.find((n) => n.type === "prompt" && !String(n.data.prompt ?? "").trim());
        if (empty && /prompt/i.test(message)) setSelectedId(empty.id);
      }
    }
  };

  const resetRun = () => {
    setRun(null);
    setNodes((ns) => ns.map((n) => ({ ...toRF(toSavable(fromRF(n))), selected: n.selected })));
  };

  const copyFlow = async () => {
    setCopying(true);
    try {
      await save();
      const copy = await FlowsApi.duplicate(flow.id);
      qc.invalidateQueries({ queryKey: ["flows"] });
      toast.success(`Copied as "${copy.name}"`);
      router.push(`/flows/${copy.id}`);
    } catch (err) {
      toast.error(apiError(err).message);
    } finally {
      setCopying(false);
    }
  };

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const hasResults = !running && !!run;

  const addNodeRef = useRef(addNode);
  addNodeRef.current = addNode;
  const actions = useMemo(() => ({ addAfter: (id: string) => addNodeRef.current("prompt", id), select: setSelectedId, indexOf }), [indexOf]);
  const onNodeClick = useCallback((_: unknown, n: RFNode) => setSelectedId(n.id), []);
  const onPaneClick = useCallback(() => setSelectedId(null), []);
  const onNodesDelete = useCallback((del: RFNode[]) => setSelectedId((cur) => (del.some((d) => d.id === cur) ? null : cur)), []);

  // Inspector "Save": write now, close the panel.
  const saveAndClose = useCallback(async () => {
    await save();
    setSelectedId(null);
    toast.success("Saved");
  }, [save]);

  return (
    <FlowActions.Provider value={actions}>
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/70 px-4 py-2.5 backdrop-blur-md">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" aria-label="All flows">
            <Link href="/flows"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-56 border-transparent bg-transparent font-display text-base font-bold hover:border-border focus:border-input"
            aria-label="Flow name"
          />
          <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex" aria-live="polite">
            {saveState === "saving" ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>
            ) : saveState === "error" ? (
              <><AlertCircle className="h-3 w-3 text-destructive" /> Not saved</>
            ) : (
              <><Check className="h-3 w-3 text-mint" /> Saved</>
            )}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => addNode("prompt")} disabled={running}>
              <MessageSquarePlus className="h-4 w-4" /> Prompt
            </Button>
            <Button variant="outline" size="sm" onClick={() => addNode("output")} disabled={running}>
              <ImageIcon className="h-4 w-4" /> Output
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={copyFlow} disabled={copying}>
              {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />} Copy
            </Button>
            {hasResults && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetRun}>
                <RotateCcw className="h-4 w-4" /> Clear results
              </Button>
            )}
            <BatchRunButton
              flowId={flow.id}
              costPerPhoto={cost}
              disabled={running || batchRunning}
              beforeStart={save}
              onStarted={setBatch}
              openOnArrival={pickPhotos}
            />
            <Button size="sm" onClick={startRun} disabled={running || batchRunning} className="h-9 px-4">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
              {running ? "Running…" : "Run flow"}
              {!running && (
                <span className="rounded-full bg-primary-foreground/15 px-2 py-0.5 font-mono text-[10px]" title="Estimated cost at your AI provider's list price">
                  ≈ {usd(cost)}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative flex-1">
          {batch && <BatchPanel flowId={flow.id} batch={batch} onChange={setBatch} />}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onNodesDelete={onNodesDelete}
            onlyRenderVisibleElements
            nodesDraggable={!running}
            nodesConnectable={!running}
            defaultEdgeOptions={edgeDefaults}
            colorMode={resolvedTheme === "light" ? "light" : "dark"}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            snapToGrid
            snapGrid={[20, 20]}
            minZoom={0.3}
            proOptions={{ hideAttribution: true }}
            className="backdropads-flow"
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="hsl(var(--foreground) / 0.14)" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeColor={(n) => (n.type === "output" ? "hsl(80 100% 62%)" : "hsl(258 95% 68%)")}
              maskColor="hsl(var(--background) / 0.7)"
              style={{ right: selected ? 440 : 12 }}
            />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-2xl border border-dashed border-border bg-card/60 px-5 py-3 text-sm text-muted-foreground">
                Add a <span className="font-semibold text-foreground">Prompt</span> to start, then an <span className="font-semibold text-foreground">Output</span> at the end.
              </p>
            </div>
          )}

          {selected && (
            <FlowInspector
              key={selected.id}
              node={fromRF(selected)}
              stepNumber={indexOf(selected.id) + 1}
              onChange={(patch) => patchNode(selected.id, patch)}
              onClose={() => setSelectedId(null)}
              onSave={saveAndClose}
              onDelete={() => removeNode(selected.id)}
              onDuplicate={() => duplicateNode(selected.id)}
            />
          )}
        </div>
      </div>
    </FlowActions.Provider>
  );
}

export function FlowBoard({ flow }: { flow: FlowDoc }) {
  return (
    <ReactFlowProvider>
      <Board flow={flow} />
    </ReactFlowProvider>
  );
}
