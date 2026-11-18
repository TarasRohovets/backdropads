import { api } from "./client";

export type UploadKind = "image" | "video" | "pdf" | "text";

/**
 * Why the file was uploaded. Everything lands in the workspace's Uploads library.
 * source = a photo to build ads from · attachment = composer/flow context · ad = an ad to analyze · logo = brand kit
 */
export type UploadPurpose = "source" | "attachment" | "ad" | "logo";

export interface Upload {
  id: string;
  url: string;
  kind: UploadKind;
  purpose: UploadPurpose;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export interface UploadResult extends Partial<Upload> {
  url: string;
  imageSeed: string;
  kind?: UploadKind;
}

/** Photos worth offering when the user starts an ad again (not logos, not ads they analyzed). */
export const isReusablePhoto = (u: Upload) => u.kind === "image" && u.purpose !== "logo" && u.purpose !== "ad";

export const UploadsApi = {
  /**
   * Upload a file (images, PDF, text — enforced by the API). It's stored in the user's Uploads library.
   * `purpose: "ad"` is the Analyze exception that also accepts the ad itself as video.
   */
  upload: async (file?: File, purpose?: UploadPurpose): Promise<UploadResult> => {
    const url = purpose ? `/uploads?purpose=${purpose}` : "/uploads";
    if (file) {
      const form = new FormData();
      form.append("file", file);
      const res = await api.post<UploadResult>(url, form);
      return res.data;
    }
    const res = await api.post<UploadResult>(url);
    return res.data;
  },
  list: async (params?: { kind?: UploadKind; purpose?: UploadPurpose }): Promise<Upload[]> =>
    (await api.get<Upload[]>("/uploads", { params })).data,
  get: async (id: string): Promise<Upload> => (await api.get<Upload>(`/uploads/${id}`)).data,
  remove: async (id: string): Promise<void> => {
    await api.delete(`/uploads/${id}`);
  },
};
