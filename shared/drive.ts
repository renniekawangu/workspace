/** Shared by the browser and api/drive.ts so both enforce the same upload rules. */

/** Vercel functions accept bodies up to 4.5 MB; stay under it. Larger files go straight into the Drive folder. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Deliberately no HTML, SVG, scripts or executables: files in the library are shared with the team. */
export const ALLOWED_UPLOAD_MIME: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/** Asset library category for a file type (users can change it before adding). */
export function categoryForMime(
  mime: string,
): "Image" | "Video" | "Document" | "Other" {
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("video/")) return "Video";
  if (
    mime === "application/pdf" ||
    mime.startsWith("text/") ||
    mime.includes("word") ||
    mime.includes("excel") ||
    mime.includes("spreadsheet") ||
    mime.includes("powerpoint") ||
    mime.includes("presentation")
  )
    return "Document";
  return "Other";
}
