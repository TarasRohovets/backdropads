import { api } from "./client";

export type ModelStatus = "available" | "unavailable" | "error" | "unverified" | "notConfigured";

export interface ProviderStatus {
  id: string;
  name: string;
  /** environment variable(s) that hold this provider's key */
  envVars: string[];
  /** which models it powers */
  powers: string;
  keyUrl: string;
  configured: boolean;
}

export interface ModelProbe {
  id: string;
  label: string;
  kind: "image" | "video" | "edit" | "voice" | "text";
  provider: string;
  providerModelId: string;
  inAutoChain: boolean;
}

export interface ModelCheckResult extends ModelProbe {
  status: ModelStatus;
  detail: string;
}

export interface ModelCheckReport {
  id: number;
  checkedAt: string;
  trigger: "weekly" | "manual";
  unavailable: number;
  results: ModelCheckResult[];
}

export interface ModelUsage {
  id: string;
  picked7d: number;
  picked30d: number;
  fellBack30d: number;
  served7d: number;
  served30d: number;
}

export interface UsageTotals {
  images7d: number;
  videos7d: number;
  costUsd7d: number;
  images30d: number;
  videos30d: number;
  costUsd30d: number;
}

export interface SystemInfo {
  /** demo mode: nothing is sent to a provider */
  mockMode: boolean;
  /** "folder" or "azure" */
  storage: string;
  providers: ProviderStatus[];
  models: ModelProbe[];
  usage: ModelUsage[];
  totals: UsageTotals;
  /** true once "Update models" has moved a model past the version the app shipped with */
  modelsUpdated: boolean;
  lastCheck: ModelCheckReport | null;
  nextWeeklyCheckAfter: string | null;
  chains: { image: string[]; imageEdit: string[]; video: string[]; ugcVideo: string[] };
}

/** One model that "Update models" moved to a newer version. */
export interface ModelUpdateChange {
  id: string;
  /** the new display name, e.g. "GPT Image 2.7 Flare" */
  label: string;
  provider: string;
  from: string;
  to: string;
}

export interface ModelUpdateResult {
  checkedAt: string;
  changes: ModelUpdateChange[];
  /** models already on their newest version */
  upToDate: number;
  /** providers that could not be checked, and why */
  skipped: { provider: string; reason: string }[];
  /** models that still need attention after the update */
  unavailable: number;
}

export const SystemApi = {
  get: async (): Promise<SystemInfo> => (await api.get<SystemInfo>("/settings/system")).data,
  /** Asks each provider whether its models still exist (free lookups; nothing is generated or switched). */
  checkModels: async (): Promise<ModelCheckReport> => (await api.post<ModelCheckReport>("/settings/models/check")).data,
  /** Finds the newest version of every model at its provider and switches the settings to it (free lookups). */
  updateModels: async (): Promise<ModelUpdateResult> => (await api.post<ModelUpdateResult>("/settings/models/update")).data,
  /** Back to the model versions the app shipped with. */
  resetModels: async (): Promise<ModelCheckReport> => (await api.post<ModelCheckReport>("/settings/models/reset")).data,
};
