import { api } from "./client";
import type { CreativeType, Generation, Platform, Roast } from "@/models";

export interface CreateRoastRequest {
  adId?: string | null;
  sourceUrl?: string | null;
  platform: Platform;
  targetMarket: string;
  language: string;
}

export const RoastsApi = {
  create: async (body: CreateRoastRequest): Promise<Roast> => {
    const res = await api.post<Roast>("/roasts", body);
    return res.data;
  },
  list: async (): Promise<Roast[]> => {
    const res = await api.get<Roast[]>("/roasts");
    return res.data;
  },
  get: async (id: string): Promise<Roast> => {
    const res = await api.get<Roast>(`/roasts/${id}`);
    return res.data;
  },
  improve: async (id: string, creativeType?: CreativeType): Promise<Generation> => {
    const res = await api.post<Generation>(`/roasts/${id}/improve`, creativeType ? { creativeType } : {});
    return res.data;
  },
};
