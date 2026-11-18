import { api } from "./client";
import type { BrandKit, BrandScanResult } from "@/models";

/** One shape for creating and editing a brand kit, everywhere in the product. */
export interface BrandKitInput {
  brandName: string;
  logoUrl?: string | null;
  colors?: string[];
  /** [heading, body] */
  fonts?: string[];
  context?: string | null;
  websiteUrl?: string | null;
}

export const BrandKitApi = {
  /** The primary brand kit. */
  get: async (): Promise<BrandKit> => {
    const res = await api.get<BrandKit>("/brand-kit");
    return res.data;
  },
  /** Primary kit first, then any additional kits. */
  list: async (): Promise<BrandKit[]> => {
    const res = await api.get<BrandKit[]>("/brand-kits");
    return res.data;
  },
  create: async (body: BrandKitInput): Promise<BrandKit> => {
    const res = await api.post<BrandKit>("/brand-kits", body);
    return res.data;
  },
  update: async (id: string, body: BrandKitInput): Promise<BrandKit> => {
    const res = await api.put<BrandKit>(`/brand-kits/${id}`, body);
    return res.data;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/brand-kits/${id}`);
  },
  /** Read a website for name, logo, colors, fonts and description. Nothing is saved. */
  scan: async (url: string): Promise<BrandScanResult> => {
    const res = await api.post<BrandScanResult>("/brand-kits/scan", { url });
    return res.data;
  },
};
