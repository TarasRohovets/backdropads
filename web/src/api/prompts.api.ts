import { api } from "./client";
import type { PromptGroup, SavedPrompt } from "@/models";

export interface ImprovePromptRequest {
  idea: string;
  mode: "image" | "video";
  aspectRatio?: string;
  platform?: string;
  model?: string;
  durationSeconds?: number | null;
  productName?: string | null;
  hasProductPhoto?: boolean;
  brandKitId?: string;
  /** Claude model id (Sonnet by default; Opus or Fable when picked) */
  textModel?: string;
}

export interface ImprovedPrompt {
  title: string;
  prompt: string;
  /** false = AI was unavailable and a structured version was returned */
  byAi: boolean;
  /** which Claude model wrote it */
  model?: string | null;
  used: number;
  limit: number;
}

export interface PromptAiModel {
  id: string;
  name: string;
  /** rough cost of one request relative to the standard model */
  units: number;
  available: boolean;
}

export interface PromptAi {
  plan: string;
  admin: boolean;
  live: boolean;
  models: PromptAiModel[];
  defaultModel: string;
  used: number;
  limit: number;
  /** null = no monthly limit (self-hosted) */
  renewsAt: string | null;
}

export interface ComposedPrompts {
  group: PromptGroup;
  byAi: boolean;
  model: string | null;
  used: number;
  limit: number;
}

export const PromptsApi = {
  list: async (): Promise<SavedPrompt[]> => (await api.get<SavedPrompt[]>("/prompts")).data,
  create: async (body: { title?: string; text: string; kind: "image" | "video" }): Promise<SavedPrompt> =>
    (await api.post<SavedPrompt>("/prompts", body)).data,
  update: async (id: string, body: { title?: string; text?: string; kind?: "image" | "video" }): Promise<SavedPrompt> =>
    (await api.put<SavedPrompt>(`/prompts/${id}`, body)).data,
  remove: async (id: string): Promise<void> => {
    await api.delete(`/prompts/${id}`);
  },
  /** Counts a use (when it's put into Create). */
  use: async (id: string): Promise<SavedPrompt> => (await api.post<SavedPrompt>(`/prompts/${id}/use`)).data,
  /** "Write with AI": one message → a group of prompts for the chosen image / video model. */
  compose: async (body: { message: string; mode?: "image" | "video"; targetModel?: string; textModel?: string }): Promise<ComposedPrompts> =>
    (await api.post<ComposedPrompts>("/prompts/compose", body)).data,
  groups: async (): Promise<PromptGroup[]> => (await api.get<PromptGroup[]>("/prompts/groups")).data,
  renameGroup: async (id: string, name: string): Promise<void> => {
    await api.put(`/prompts/groups/${id}`, { name });
  },
  /** Deletes the group and its prompts. */
  removeGroup: async (id: string): Promise<void> => {
    await api.delete(`/prompts/groups/${id}`);
  },
  /** The Claude models for text work. */
  ai: async (): Promise<PromptAi> => (await api.get<PromptAi>("/prompts/ai")).data,
  /** "Improve with AI": a rough idea → a prompt written for image or video models. Uses your Anthropic key. */
  improve: async (body: ImprovePromptRequest): Promise<ImprovedPrompt> => (await api.post<ImprovedPrompt>("/prompts/improve", body)).data,
};
