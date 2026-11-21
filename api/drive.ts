import { Readable } from "node:stream";
import type { ReadableStream as WebStream } from "node:stream/web";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, requireStaff } from "./_lib/auth";
import {
  ALLOWED_UPLOAD_MIME,
  MAX_UPLOAD_BYTES,
  NATIVE_PREFIX,
  driveConfig,
  getMeta,
  listFiles,
  openMedia,
  safeFileName,
  uploadFile,
} from "./_lib/drive";

const ROLES = ["admin", "digitalops", "designer"] as const;
const ID = /^[A-Za-z0-9_-]{10,100}$/;

async function readBody(req: VercelRequest, max: number) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > max)
      throw new HttpError(
        413,
        "That file is too large to upload here. Put it in the Drive folder directly.",
      );
    return req.body;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > max)
      throw new HttpError(
        413,
        "That file is too large to upload here. Put it in the Drive folder directly.",
      );
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Asset library <-> Google Drive. Everything is scoped to one folder (GOOGLE_DRIVE_FOLDER_ID).
 *   GET  ?action=list&q=&pageToken=   files in the folder
 *   GET  ?action=file&id=             download (proxied, so Drive access is not needed)
 *   POST ?action=upload               raw body, headers X-File-Name and X-File-Type
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  try {
    await requireStaff(req, ROLES);
    const action = String(req.query.action ?? "");
    const cfg = driveConfig();

    if (req.method === "GET" && action === "list") {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const page =
        typeof req.query.pageToken === "string"
          ? req.query.pageToken.slice(0, 2000)
          : "";
      return res.status(200).json(await listFiles(cfg, q, page));
    }

    if (req.method === "GET" && action === "file") {
      const id = String(req.query.id ?? "");
      if (!ID.test(id)) throw new HttpError(400, "Invalid file id.");
      const meta = await getMeta(cfg, id);
      if (String(meta.mimeType).startsWith(NATIVE_PREFIX))
        throw new HttpError(
          415,
          "Google Docs, Sheets and Slides cannot be downloaded here. Use Open in Drive.",
        );
      const media = await openMedia(cfg, id);
      if (!media.body)
        throw new HttpError(502, "Google Drive returned an empty file.");
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(String(meta.name))}`,
      );
      const len = media.headers.get("content-length");
      if (len) res.setHeader("Content-Length", len);
      res.status(200);
      Readable.fromWeb(media.body as unknown as WebStream).pipe(res);
      return;
    }

    if (req.method === "POST" && action === "upload") {
      const type = String(req.headers["x-file-type"] ?? "").toLowerCase();
      if (!ALLOWED_UPLOAD_MIME.has(type))
        throw new HttpError(
          415,
          "That file type is not allowed. Use images, videos, PDFs, Office files or text.",
        );
      const body = await readBody(req, MAX_UPLOAD_BYTES);
      if (!body.length) throw new HttpError(400, "The file is empty.");
      const file = await uploadFile(
        cfg,
        safeFileName(String(req.headers["x-file-name"] ?? "")),
        type,
        body,
      );
      return res.status(200).json({ ok: true, file });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (err) {
    if (err instanceof HttpError)
      return res.status(err.status).json({ error: err.message, ...err.extra });
    console.error("drive: unexpected error", err);
    return res
      .status(500)
      .json({
        error: "Something went wrong with Google Drive. Please try again.",
      });
  }
}
