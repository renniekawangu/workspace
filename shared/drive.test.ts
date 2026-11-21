import { describe, expect, it } from "vitest";
import {
  ALLOWED_UPLOAD_MIME,
  MAX_UPLOAD_BYTES,
  categoryForMime,
} from "./drive";

describe("categoryForMime", () => {
  it.each([
    ["image/png", "Image"],
    ["video/mp4", "Video"],
    ["application/pdf", "Document"],
    ["text/csv", "Document"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Document",
    ],
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Document",
    ],
    [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Document",
    ],
    ["application/zip", "Other"],
    ["", "Other"],
  ])("%s -> %s", (mime, cat) => expect(categoryForMime(mime)).toBe(cat));
});

describe("upload rules", () => {
  it("stays under the Vercel body limit", () =>
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024));
  it("allows common creative files and blocks active content", () => {
    expect(ALLOWED_UPLOAD_MIME.has("image/jpeg")).toBe(true);
    for (const t of ["text/html", "image/svg+xml", "application/x-msdownload"])
      expect(ALLOWED_UPLOAD_MIME.has(t)).toBe(false);
  });
});
