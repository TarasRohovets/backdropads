import { api } from "./client";
import type { Folder, FolderColor } from "@/models";

export const FoldersApi = {
  /** Every folder in the workspace (flat; nest them with parentId). The first call creates the starter folders. */
  list: async (): Promise<Folder[]> => (await api.get<Folder[]>("/folders")).data,
  create: async (body: { name: string; parentId?: string | null; color?: FolderColor }): Promise<Folder> =>
    (await api.post<Folder>("/folders", { ...body, parentId: body.parentId ?? "" })).data,
  /** parentId "" moves it to the top level. */
  update: async (id: string, body: { name?: string; color?: FolderColor; parentId?: string }): Promise<Folder> =>
    (await api.put<Folder>(`/folders/${id}`, body)).data,
  /** Deletes the folder and its subfolders; their ads stay in My Ads. */
  remove: async (id: string): Promise<void> => {
    await api.delete(`/folders/${id}`);
  },
};
