import { api } from "./client";
import type { Product } from "@/models";

export interface CreateProductRequest {
  name: string;
  sourceImageUrl: string;
  notes?: string | null;
  /** "Make it my brand": replace labels/branding with the Brand Kit. */
  rebrand: boolean;
}

/** What POST /api/products/import read off a product page. */
export interface ProductImport {
  sourceUrl: string;
  platform: "shopify" | "woocommerce" | "generic";
  title: string;
  description?: string | null;
  brand?: string | null;
  price?: string | null;
  currency?: string | null;
  images: string[];
}

export const ProductsApi = {
  /** Paste-a-product-link: title, price, description and photos (Shopify first-class). */
  importUrl: async (url: string): Promise<ProductImport> => {
    const res = await api.post<ProductImport>("/products/import", { url });
    return res.data;
  },
  list: async (): Promise<Product[]> => {
    const res = await api.get<Product[]>("/products");
    return res.data;
  },
  create: async (body: CreateProductRequest): Promise<Product> => {
    const res = await api.post<Product>("/products", body);
    return res.data;
  },
  update: async (id: string, body: { name?: string; notes?: string | null }): Promise<Product> => {
    const res = await api.put<Product>(`/products/${id}`, body);
    return res.data;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/products/${id}`);
  },
};
