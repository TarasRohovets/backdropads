import axios from "axios";

/** Current workspace (sent as X-Workspace-Id; the API falls back to the first one). */
export const WORKSPACE_KEY = "backdropads_workspace";

// Same origin: the web app proxies /api to the API (next.config.mjs). NEXT_PUBLIC_API_URL overrides it for
// setups where the API lives on another host.
export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "/api",
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const workspace = localStorage.getItem(WORKSPACE_KEY);
    if (workspace) {
      config.headers["X-Workspace-Id"] = workspace;
    }
  }
  return config;
});

export const getWorkspaceId = () => (typeof window !== "undefined" ? localStorage.getItem(WORKSPACE_KEY) : null);
export const setWorkspaceId = (id: string) => localStorage.setItem(WORKSPACE_KEY, id);

/** Extracts { status, message, retryAfterSeconds? } from an axios error. */
export const apiError = (err: unknown): { status?: number; message: string; retryAfterSeconds?: number } => {
  const e = err as { response?: { status: number; data?: { error?: string; retryAfterSeconds?: number } } };
  return {
    status: e.response?.status,
    message: e.response?.data?.error ?? "Something went wrong. Is the API running?",
    retryAfterSeconds: e.response?.data?.retryAfterSeconds,
  };
};
