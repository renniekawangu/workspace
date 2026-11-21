import type { VercelRequest } from "@vercel/node";
import { adminAuth, adminDb } from "./admin";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/**
 * Verifies the Firebase ID token and the roles/{uid} document, the same source of truth the
 * Firestore rules use. `allowed` limits the roles; omit it to accept any active staff member.
 */
export async function requireStaff(
  req: VercelRequest,
  allowed?: readonly string[],
) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Sign in again and retry.");
  let uid: string;
  try {
    uid = (await adminAuth().verifyIdToken(token)).uid;
  } catch {
    throw new HttpError(401, "Your session has expired. Sign in again.");
  }
  const role = (await adminDb().doc(`roles/${uid}`).get()).data();
  if (!role || role.active !== true || typeof role.role !== "string")
    throw new HttpError(403, "Your account is inactive or has no role.");
  if (allowed && !allowed.includes(role.role))
    throw new HttpError(403, "Your role cannot do this.");
  return { uid, role: role.role as string };
}

export function readJson(req: VercelRequest): Record<string, unknown> {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}
