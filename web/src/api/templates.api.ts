import { api } from "./client";
import type { CreativeType, Platform, Template } from "@/models";

export interface TemplateFilters {
  platform?: Platform;
  creativeType?: CreativeType;
  category?: string;
}

export const TemplatesApi = {
  list: async (filters: TemplateFilters = {}): Promise<Template[]> => {
    const res = await api.get<Template[]>("/templates", { params: filters });
    return res.data;
  },
};
