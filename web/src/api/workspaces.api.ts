import { api } from "./client";
import type { Workspace, WorkspaceList } from "@/models";

export const WorkspacesApi = {
  list: async (): Promise<WorkspaceList> => {
    const res = await api.get<WorkspaceList>("/workspaces");
    return res.data;
  },
  create: async (name: string): Promise<Workspace> => {
    const res = await api.post<Workspace>("/workspaces", { name });
    return res.data;
  },
  rename: async (id: string, name: string): Promise<Workspace> => {
    const res = await api.put<Workspace>(`/workspaces/${id}`, { name });
    return res.data;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/workspaces/${id}`);
  },
};
