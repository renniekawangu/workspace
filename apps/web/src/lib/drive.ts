import { auth } from "./firebase";

export {
  ALLOWED_UPLOAD_MIME,
  MAX_UPLOAD_BYTES,
  categoryForMime,
} from "../../../../shared/drive";
import {
  ALLOWED_UPLOAD_MIME,
  MAX_UPLOAD_BYTES,
} from "../../../../shared/drive";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  webViewLink: string;
};

export class DriveError extends Error {}

async function authed(path: string, init: RequestInit = {}) {
  const user = auth.currentUser;
  if (!user) throw new DriveError("Sign in again and retry.");
  try {
    return await fetch(path, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
    });
  } catch {
    throw new DriveError("Could not reach the server. Check your connection.");
  }
}

async function fail(res: Response, fallback: string): Promise<never> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  throw new DriveError(data.error || fallback);
}

export async function listDriveFiles(search = "", pageToken = "") {
  const q = new URLSearchParams({ action: "list" });
  if (search.trim()) q.set("q", search.trim());
  if (pageToken) q.set("pageToken", pageToken);
  const res = await authed(`/api/drive?${q}`);
  if (!res.ok) await fail(res, "Could not load files from Google Drive.");
  return (await res.json()) as { files: DriveFile[]; nextPageToken: string };
}

/** Why a file cannot be uploaded through the app, or "" if it can. */
export function uploadProblem(file: File) {
  if (!ALLOWED_UPLOAD_MIME.has(file.type))
    return "That file type is not allowed. Use images, videos, PDFs, Office files or text.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_UPLOAD_BYTES)
    return "Files over 4 MB can't be uploaded here. Put them in the Drive folder, then add them from the list.";
  return "";
}

export async function uploadToDrive(file: File) {
  const problem = uploadProblem(file);
  if (problem) throw new DriveError(problem);
  const res = await authed("/api/drive?action=upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
      "X-File-Type": file.type,
    },
    body: file,
  });
  if (!res.ok) await fail(res, "Upload failed.");
  return ((await res.json()) as { file: DriveFile }).file;
}

export async function downloadFromDrive(id: string, name: string) {
  const res = await authed(
    `/api/drive?action=file&id=${encodeURIComponent(id)}`,
  );
  if (!res.ok) await fail(res, "Download failed.");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob());
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
