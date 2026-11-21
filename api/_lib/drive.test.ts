import { describe, expect, it } from "vitest";
import {
  ALLOWED_UPLOAD_MIME,
  driveConfig,
  escapeQuery,
  isInFolder,
  listQuery,
  multipartBody,
  safeFileName,
  toDriveFile,
} from "./drive";

describe("driveConfig", () => {
  const env = {
    GOOGLE_OAUTH_CLIENT_ID: "id",
    GOOGLE_OAUTH_CLIENT_SECRET: "s",
    GOOGLE_OAUTH_REFRESH_TOKEN: "r",
    GOOGLE_DRIVE_FOLDER_ID: "1AbCdEfGhIjKlMnOp",
  };
  it("accepts a full config", () =>
    expect(driveConfig(env).folderId).toBe("1AbCdEfGhIjKlMnOp"));
  it("says Drive is not connected when anything is missing", () => {
    expect(() =>
      driveConfig({ ...env, GOOGLE_OAUTH_REFRESH_TOKEN: "" }),
    ).toThrow(/not connected/);
    expect(() => driveConfig({})).toThrow(/not connected/);
  });
  it("rejects a malformed folder id", () =>
    expect(() =>
      driveConfig({ ...env, GOOGLE_DRIVE_FOLDER_ID: "a' or '1'='1" }),
    ).toThrow(/valid folder id/));
});

describe("listQuery", () => {
  it("scopes to the folder and excludes trash and folders", () => {
    const q = listQuery("FOLDER12345", "");
    expect(q).toContain("'FOLDER12345' in parents");
    expect(q).toContain("trashed = false");
    expect(q).toContain("mimeType != 'application/vnd.google-apps.folder'");
    expect(q).not.toContain("name contains");
  });
  it("escapes quotes so a search cannot break out of the query", () => {
    expect(escapeQuery("it's a \\ test")).toBe("it\\'s a \\\\ test");
    expect(listQuery("F", "x' or trashed = true or name contains '")).toContain(
      "name contains 'x\\' or trashed = true or name contains \\''",
    );
  });
  it("caps the search length", () =>
    expect(listQuery("F", "a".repeat(500)).length).toBeLessThan(400));
});

describe("safeFileName", () => {
  it("keeps normal names and decodes percent-encoding", () =>
    expect(safeFileName("Logo%20final.png")).toBe("Logo final.png"));
  it("strips path separators, control characters and leading dots", () => {
    const n = safeFileName("../../etc/passwd");
    expect(n).not.toMatch(/[\\/]/);
    expect(n.startsWith(".")).toBe(false);
    expect(n).toContain("etc-passwd");
    expect(safeFileName("a\r\nb.png")).toBe("ab.png");
    expect(safeFileName("..hidden")).toBe("hidden");
  });
  it("falls back for empty names and tolerates bad encoding", () => {
    expect(safeFileName("")).toBe("file");
    expect(safeFileName("%E0%A4%A")).toBeTruthy();
    expect(safeFileName("x".repeat(400)).length).toBe(150);
  });
});

describe("isInFolder", () => {
  it("only accepts live direct children of the folder", () => {
    expect(isInFolder({ parents: ["F"] }, "F")).toBe(true);
    expect(isInFolder({ parents: ["OTHER"] }, "F")).toBe(false);
    expect(isInFolder({ parents: ["F"], trashed: true }, "F")).toBe(false);
    expect(isInFolder({}, "F")).toBe(false);
  });
});

describe("uploads", () => {
  it("blocks HTML, SVG and executables", () => {
    for (const t of [
      "text/html",
      "image/svg+xml",
      "application/x-msdownload",
      "application/javascript",
    ])
      expect(ALLOWED_UPLOAD_MIME.has(t)).toBe(false);
    for (const t of ["image/png", "video/mp4", "application/pdf"])
      expect(ALLOWED_UPLOAD_MIME.has(t)).toBe(true);
  });
  it("builds a multipart body with the metadata, the bytes and the closing boundary", () => {
    const body = multipartBody(
      { name: "a.png", parents: ["F"] },
      "image/png",
      Buffer.from([1, 2, 3]),
      "BOUND",
    ).toString("latin1");
    expect(body.startsWith("--BOUND\r\nContent-Type: application/json")).toBe(
      true,
    );
    expect(body).toContain('"parents":["F"]');
    expect(body.endsWith("\r\n--BOUND--")).toBe(true);
  });
  it("maps raw files with a numeric size", () =>
    expect(toDriveFile({ id: "1", name: "n", size: "42" }).size).toBe(42));
});
