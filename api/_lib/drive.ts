import { HttpError } from "./auth";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const FOLDER_MIME = "application/vnd.google-apps.folder";
export const NATIVE_PREFIX = "application/vnd.google-apps.";
const FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed";

export { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES } from "../../shared/drive";

export type DriveConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId: string;
};
export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  webViewLink: string;
};
type RawFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
};

export function driveConfig(
  env: Record<string, string | undefined> = process.env,
): DriveConfig {
  const c = {
    clientId: (env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim(),
    clientSecret: (env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim(),
    refreshToken: (env.GOOGLE_OAUTH_REFRESH_TOKEN ?? "").trim(),
    folderId: (env.GOOGLE_DRIVE_FOLDER_ID ?? "").trim(),
  };
  if (!c.clientId || !c.clientSecret || !c.refreshToken || !c.folderId)
    throw new HttpError(
      503,
      "Google Drive is not connected yet. An admin needs to finish the Drive setup.",
    );
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(c.folderId))
    throw new HttpError(
      503,
      "GOOGLE_DRIVE_FOLDER_ID is not a valid folder id.",
    );
  return c;
}

/** Escapes a value for use inside a single-quoted Drive query string. */
export const escapeQuery = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export function listQuery(folderId: string, search: string) {
  const parts = [
    `'${folderId}' in parents`,
    "trashed = false",
    `mimeType != '${FOLDER_MIME}'`,
  ];
  const term = search.trim().slice(0, 100);
  if (term) parts.push(`name contains '${escapeQuery(term)}'`);
  return parts.join(" and ");
}

/** Safe single path segment for a file name taken from a request header. */
export function safeFileName(raw: string) {
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  name = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  return name.replace(/^\.+/, "") || "file";
}

export function multipartBody(
  meta: Record<string, unknown>,
  mime: string,
  data: Buffer,
  boundary: string,
) {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
}

export const toDriveFile = (f: RawFile): DriveFile => ({
  id: String(f.id ?? ""),
  name: String(f.name ?? ""),
  mimeType: String(f.mimeType ?? ""),
  size: Number(f.size ?? 0) || 0,
  modifiedTime: String(f.modifiedTime ?? ""),
  webViewLink: String(f.webViewLink ?? ""),
});

/** Every file operation is limited to direct children of the configured folder. */
export const isInFolder = (f: RawFile, folderId: string) =>
  !f.trashed && Array.isArray(f.parents) && f.parents.includes(folderId);

let cached: { token: string; exp: number } | undefined;

async function accessToken(cfg: DriveConfig) {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    console.error("drive: token refresh failed", body.error);
    throw new HttpError(
      503,
      body.error === "invalid_grant"
        ? "Google Drive access has expired or was revoked. An admin needs to run `npm run drive:auth` again."
        : "Could not sign in to Google Drive.",
    );
  }
  cached = {
    token: body.access_token,
    exp: Date.now() + (body.expires_in ?? 3000) * 1000,
  };
  return cached.token;
}

export async function driveFetch(
  cfg: DriveConfig,
  url: string,
  init: RequestInit = {},
) {
  const send = async () =>
    fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        Authorization: `Bearer ${await accessToken(cfg)}`,
      },
    });
  let res = await send();
  if (res.status === 401) {
    cached = undefined;
    res = await send();
  }
  return res;
}

async function ok(res: Response, what: string) {
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  console.error(`drive: ${what} failed`, res.status, text.slice(0, 500));
  if (res.status === 404)
    throw new HttpError(404, "That file was not found in the asset folder.");
  throw new HttpError(
    502,
    "Google Drive could not complete that request. Try again in a moment.",
  );
}

export async function listFiles(
  cfg: DriveConfig,
  search: string,
  pageToken: string,
) {
  const u = new URL(`${API}/files`);
  u.searchParams.set("q", listQuery(cfg.folderId, search));
  u.searchParams.set("pageSize", "50");
  u.searchParams.set("orderBy", "modifiedTime desc");
  u.searchParams.set("fields", `nextPageToken,files(${FIELDS})`);
  u.searchParams.set("supportsAllDrives", "true");
  u.searchParams.set("includeItemsFromAllDrives", "true");
  if (pageToken) u.searchParams.set("pageToken", pageToken);
  const data = (await (
    await ok(await driveFetch(cfg, u.toString()), "list")
  ).json()) as { files?: RawFile[]; nextPageToken?: string };
  return {
    files: (data.files ?? [])
      .filter((f) => isInFolder(f, cfg.folderId))
      .map(toDriveFile),
    nextPageToken: data.nextPageToken ?? "",
  };
}

export async function getMeta(cfg: DriveConfig, id: string) {
  const res = await driveFetch(
    cfg,
    `${API}/files/${id}?fields=${encodeURIComponent(FIELDS)}&supportsAllDrives=true`,
  );
  const meta = (await (await ok(res, "get")).json()) as RawFile;
  if (!isInFolder(meta, cfg.folderId))
    throw new HttpError(404, "That file was not found in the asset folder.");
  return meta;
}

export const openMedia = (cfg: DriveConfig, id: string) =>
  driveFetch(cfg, `${API}/files/${id}?alt=media&supportsAllDrives=true`).then(
    (r) => ok(r, "download"),
  );

export async function uploadFile(
  cfg: DriveConfig,
  name: string,
  mime: string,
  data: Buffer,
) {
  const boundary = `b34st${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const res = await driveFetch(
    cfg,
    `${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(FIELDS)}`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipartBody(
        { name, parents: [cfg.folderId] },
        mime,
        data,
        boundary,
      ),
    },
  );
  return toDriveFile((await (await ok(res, "upload")).json()) as RawFile);
}
