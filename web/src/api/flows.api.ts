import { api } from "./client";
import type { FlowBatch, FlowDoc, FlowEdge, FlowNode, FlowRun, FlowTemplate, FlowFile } from "@/lib/flows";

export interface ComposedFlowResult {
  flow: FlowDoc;
  /** credits a run costs */
  cost: number;
  /** why it can't run as is (e.g. video on the free plan); null when it can */
  runError: string | null;
  byAi: boolean;
  model: string | null;
  /** only when AI wrote it */
  used?: number;
  limit?: number;
}

export interface FlowChatResult {
  flow: FlowDoc;
  reply: string;
  changed: boolean;
  version: number | null;
  cost: number;
  byAi: boolean;
  model: string | null;
  used: number;
  limit: number;
}

export const FlowsApi = {
  list: async (): Promise<FlowDoc[]> => {
    const res = await api.get<FlowDoc[]>("/flows");
    return res.data;
  },
  get: async (id: string): Promise<FlowDoc> => {
    const res = await api.get<FlowDoc>(`/flows/${id}`);
    return res.data;
  },
  /** Starter flows a new flow can begin from. */
  templates: async (): Promise<FlowTemplate[]> => {
    const res = await api.get<FlowTemplate[]>("/flows/templates");
    return res.data;
  },
  /** New flows start blank (one prompt step → one output card) or from a starter flow. */
  create: async (name?: string, templateId?: string): Promise<FlowDoc> => {
    const res = await api.post<FlowDoc>("/flows", { name: name || null, templateId: templateId || null });
    return res.data;
  },
  /** "Create with AI": one message → a new flow with one output card per image (nothing runs yet). */
  compose: async (body: { message: string; photoUrl?: string | null; photoUrls?: string[]; textModel?: string }): Promise<ComposedFlowResult> => {
    const res = await api.post<ComposedFlowResult>("/flows/compose", body);
    return res.data;
  },
  /** The chat inside a flow: AI changes the cards; the reply and the updated flow come back. */
  chat: async (id: string, body: { message: string; textModel?: string }): Promise<FlowChatResult> => {
    const res = await api.post<FlowChatResult>(`/flows/${id}/chat`, body);
    return res.data;
  },
  /** Back to a saved version (kept as a new version). */
  restoreVersion: async (id: string, version: number): Promise<{ flow: FlowDoc; cost: number }> => {
    const res = await api.post<{ flow: FlowDoc; cost: number }>(`/flows/${id}/versions/${version}/restore`);
    return res.data;
  },
  /** Saved prompts → a new flow, one output card per prompt (nothing runs yet). */
  fromPrompts: async (body: { groupId?: string; promptIds?: string[]; photoUrl?: string | null }): Promise<ComposedFlowResult> => {
    const res = await api.post<ComposedFlowResult>("/flows/from-prompts", body);
    return res.data;
  },
  /** Creates a flow from a file made by "Export". */
  importFile: async (file: FlowFile): Promise<FlowDoc> => {
    const res = await api.post<FlowDoc>("/flows/import", file);
    return res.data;
  },
  update: async (id: string, body: { name?: string; nodes?: FlowNode[]; edges?: FlowEdge[] }): Promise<FlowDoc> => {
    const res = await api.put<FlowDoc>(`/flows/${id}`, body);
    return res.data;
  },
  duplicate: async (id: string): Promise<FlowDoc> => {
    const res = await api.post<FlowDoc>(`/flows/${id}/duplicate`);
    return res.data;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/flows/${id}`);
  },
  run: async (id: string): Promise<FlowRun> => {
    const res = await api.post<FlowRun>(`/flows/${id}/run`);
    return res.data;
  },
  /** Run the flow once for each photo (links from the upload library), one after another. */
  runBatch: async (id: string, inputUrls: string[]): Promise<FlowBatch> => {
    const res = await api.post<FlowBatch>(`/flows/${id}/run-batch`, { inputUrls });
    return res.data;
  },
  /** The flow's last batch, or null when it never ran on several photos. */
  getBatch: async (id: string): Promise<FlowBatch | null> => {
    const res = await api.get<FlowBatch>(`/flows/${id}/batch`);
    return res.status === 204 ? null : res.data;
  },
  getRun: async (id: string, runId: string): Promise<FlowRun> => {
    const res = await api.get<FlowRun>(`/flows/${id}/runs/${runId}`);
    return res.data;
  },
};
