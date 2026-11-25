import { api } from "./client";
import type { Ad, AdStatus, CreativeType, Platform } from "@/models";

export interface AdFilters {
  platform?: Platform;
  creativeType?: CreativeType;
  status?: AdStatus;
  search?: string;
  folderId?: string;
}

export interface SaveAdRequest {
  generationId: string;
  conceptId: string;
  name?: string;
  /** save straight into this folder */
  folderId?: string;
}

export interface UpdateAdRequest {
  name?: string;
  hook?: string;
  primaryText?: string;
  callToAction?: string;
  palette?: string[];
  status?: AdStatus;
  /** move to this folder; "" = out of its folder */
  folderId?: string;
  /** version label like "v2"; "" = clear */
  versionTag?: string;
}

export const AdsApi = {
  list: async (filters: AdFilters = {}): Promise<Ad[]> => {
    const res = await api.get<Ad[]>("/ads", { params: filters });
    return res.data;
  },
  get: async (id: string): Promise<Ad> => {
    const res = await api.get<Ad>(`/ads/${id}`);
    return res.data;
  },
  save: async (body: SaveAdRequest): Promise<Ad> => {
    const res = await api.post<Ad>("/ads", body);
    return res.data;
  },
  update: async (id: string, body: UpdateAdRequest): Promise<Ad> => {
    const res = await api.put<Ad>(`/ads/${id}`, body);
    return res.data;
  },
  duplicate: async (id: string): Promise<Ad> => {
    const res = await api.post<Ad>(`/ads/${id}/duplicate`);
    return res.data;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/ads/${id}`);
  },
  /** Refine loop: edit the ad's creative with an instruction → new current version. */
  refine: async (id: string, instruction: string): Promise<Ad> => {
    const res = await api.post<Ad>(`/ads/${id}/refine`, { instruction });
    return res.data;
  },
  /** Roll back (or forward) to a saved version. */
  restoreVersion: async (id: string, version: number): Promise<Ad> => {
    const res = await api.post<Ad>(`/ads/${id}/versions/${version}/restore`);
    return res.data;
  },
};
