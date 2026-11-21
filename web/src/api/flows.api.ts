import { api } from "./client";
import type { FlowBatch, FlowDoc, FlowEdge, FlowNode, FlowRun, FlowTemplate } from "@/lib/flows";

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
