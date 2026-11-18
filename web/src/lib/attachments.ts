// One attachment policy across the platform: images, PDF and plain text.
// Mirrors POST /api/uploads (API_CONTRACT.md V2.9).

export type AttachmentKind = "image" | "pdf" | "text";

export const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/avif,application/pdf,text/plain,text/markdown,text/csv,.md,.txt,.csv,.pdf";

export const ATTACHMENT_HINT = "Images, PDF or text · up to 20 MB each";

export const MAX_ATTACHMENT_MB = 20;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;
const TEXT_EXT = /\.(txt|md|csv)$/i;

export function attachmentKind(file: File): AttachmentKind | null {
  const type = file.type.toLowerCase();
  if (type.startsWith("image/") || IMAGE_EXT.test(file.name)) return "image";
  if (type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (type.startsWith("text/") || TEXT_EXT.test(file.name)) return "text";
  return null;
}

/** Returns an error message, or null when the file is allowed. */
export function validateAttachment(file: File): string | null {
  if (!attachmentKind(file)) return `${file.name}: only images, PDF and text files are allowed.`;
  if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) return `${file.name} is larger than ${MAX_ATTACHMENT_MB} MB.`;
  return null;
}

export const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
