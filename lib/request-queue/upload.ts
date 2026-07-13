export const REQUEST_UPLOAD_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export const REQUEST_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
