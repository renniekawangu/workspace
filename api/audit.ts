import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./_lib/admin";
import {
  AUDIT_COLLECTIONS,
  auditDocId,
  claimStamp,
  parseAuditClaim,
} from "./_lib/auditClaim";
import { HttpError, readJson, requireStaff } from "./_lib/auth";

/**
 * Server-side audit writer. Clients can no longer write auditLogs directly (see firestore.rules),
 * so an entry exists only if the target document changed recently by the caller.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const { uid } = await requireStaff(req);
    const claim = parseAuditClaim(readJson(req));
    if (!claim) throw new HttpError(400, "Invalid audit entry.");
    const collection = AUDIT_COLLECTIONS[claim.targetType];
    if (!collection) throw new HttpError(400, "Unknown target type.");
    const db = adminDb();
    const snap = await db.doc(`${collection}/${claim.targetId}`).get();
    const stamp = claimStamp(
      claim,
      snap.exists ? snap.data() : undefined,
      uid,
      Date.now(),
    );
    if (stamp === null)
      throw new HttpError(
        403,
        "That entry does not match a recent change by you.",
      );
    try {
      await db.doc(`auditLogs/${auditDocId(claim, uid, stamp)}`).create({
        actorId: uid,
        action: claim.action,
        targetType: claim.targetType,
        targetId: claim.targetId,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      if ((e as { code?: number }).code === 6)
        return res.status(200).json({ ok: true, duplicate: true });
      throw e;
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError)
      return res.status(err.status).json({ error: err.message, ...err.extra });
    console.error("audit: unexpected error", err);
    return res.status(500).json({ error: "Could not record the audit entry." });
  }
}
