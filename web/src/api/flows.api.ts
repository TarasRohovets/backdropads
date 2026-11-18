import { api } from "./client";
import type { FlowDoc, FlowEdge, FlowNode, FlowRun } from "@/lib/flows";

export const FlowsApi = {
  list: async (): Promise<FlowDoc[]> => {
    const res = await api.get<FlowDoc[]>("/flows");
    return res.data;
  },
  get: async (id: string): Promise<FlowDoc> => {
    const res = await api.get<FlowDoc>(`/flows/${id}`);
    return res.data;
  },
  /** New flows start blank: one prompt step → one output card. */
  create: async (name?: string): Promise<FlowDoc> => {
    const res = await api.post<FlowDoc>("/flows", { name: name || null });
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
  getRun: async (id: string, runId: string): Promise<FlowRun> => {
    const res = await api.get<FlowRun>(`/flows/${id}/runs/${runId}`);
    return res.data;
  },
};
