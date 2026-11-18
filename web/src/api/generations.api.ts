import { api } from "./client";
import type { Brief, Concept, CreativeType, Generation, Placement, Platform } from "@/models";

export interface CreateGenerationRequest {
  platform: Platform;
  placement: Placement;
  creativeType: CreativeType;
  brief: Brief;
  roastId?: string | null;
  /** "primary" (default), a bk_ id, or "none" to skip brand styling. */
  brandKitId?: string | null;
  /** "standard" (default) or "high" (2K images / 1080p video) — priced per model. */
  quality?: "standard" | "high" | null;
  /** model id from GET /api/models; "auto" when omitted */
  model?: string | null;
  /** video length; snapped to the model's allowed lengths */
  durationSeconds?: number | null;
  /** Generate from a saved product anchor (Brand Kit → Products). */
  productId?: string | null;
  templateId?: string | null;
  /** 1-4 for images/carousels (default 3), 1-2 for video (default 1). */
  conceptCount?: number | null;
  /** Style-inspiration slug from the wizard. */
  styleId?: string | null;
}

export const GenerationsApi = {
  create: async (body: CreateGenerationRequest): Promise<Generation> => {
    const res = await api.post<Generation>("/generations", body);
    return res.data;
  },
  list: async (): Promise<Generation[]> => {
    const res = await api.get<Generation[]>("/generations");
    return res.data;
  },
  get: async (id: string): Promise<Generation> => {
    const res = await api.get<Generation>(`/generations/${id}`);
    return res.data;
  },
  /** Same generation again — with the same model, or `model` (e.g. the suggestion after a failure). */
  regenerate: async (id: string, model?: string): Promise<Generation> => {
    const res = await api.post<Generation>(`/generations/${id}/regenerate`, { model: model ?? null });
    return res.data;
  },
  /** Refine loop: edit one concept with an instruction → new version concept. */
  refineConcept: async (generationId: string, conceptId: string, instruction: string): Promise<Concept> => {
    const res = await api.post<Concept>(`/generations/${generationId}/concepts/${conceptId}/refine`, { instruction });
    return res.data;
  },
  /** Delete one generated image/video (one version). `generationDeleted` when it was the last one. */
  deleteConcept: async (generationId: string, conceptId: string): Promise<{ deleted: string; generationDeleted: boolean }> => {
    const res = await api.delete<{ deleted: string; generationDeleted: boolean }>(`/generations/${generationId}/concepts/${conceptId}`);
    return res.data;
  },
};
