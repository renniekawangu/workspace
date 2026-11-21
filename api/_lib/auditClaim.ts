import { createHash } from "node:crypto";

/** targetType (as the web app logs it) -> Firestore collection holding the target document. */
export const AUDIT_COLLECTIONS: Record<string, string> = {
  lead: "leads",
  client: "clients",
  intake: "intakes",
  project: "projects",
  task: "tasks",
  announcement: "announcements",
  onboarding: "onboarding",
  quotation: "financeRecords",
  invoice: "financeRecords",
  socialPost: "socialPosts",
  websiteRequest: "websiteRequests",
  digitalCampaign: "digitalCampaigns",
  contentAsset: "contentAssets",
  leave: "leave",
  attendance: "attendance",
};

export type AuditClaim = {
  action: string;
  targetType: string;
  targetId: string;
};
type Stamped = { toMillis?: () => number } | null | undefined;
type Doc = Record<string, unknown> | undefined;

export const RECENT_MS = 10 * 60 * 1000;
const ACTION = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const TYPE = /^[A-Za-z][A-Za-z0-9]*$/;
const ID = /^[A-Za-z0-9_\-:.]{1,150}$/;

export function parseAuditClaim(body: unknown): AuditClaim | null {
  if (typeof body !== "object" || body === null) return null;
  const { action, targetType, targetId } = body as Record<string, unknown>;
  if (typeof action !== "string" || action.length > 100 || !ACTION.test(action))
    return null;
  if (
    typeof targetType !== "string" ||
    targetType.length > 100 ||
    !TYPE.test(targetType)
  )
    return null;
  if (typeof targetId !== "string" || !ID.test(targetId)) return null;
  return { action, targetType, targetId };
}

const millis = (t: unknown) => (t as Stamped)?.toMillis?.() ?? 0;

/**
 * An audit entry is only accepted if the target document really changed recently and the caller
 * is the person recorded on it. A deletion is accepted only when the document is gone.
 * Returns the change timestamp (ms) used to make the entry idempotent, or null to reject.
 */
export function claimStamp(
  claim: AuditClaim,
  data: Doc,
  uid: string,
  nowMs: number,
): number | null {
  if (claim.action.endsWith(".deleted"))
    return data === undefined ? Math.floor(nowMs / 60_000) * 60_000 : null;
  if (!data) return null;
  const at = millis(data.updatedAt) || millis(data.createdAt);
  if (!at || at < nowMs - RECENT_MS || at > nowMs + 60_000) return null;
  const actors =
    claim.targetType === "attendance"
      ? [data.employeeId]
      : claim.targetType === "leave"
        ? [data.employeeId, data.approverId, data.decidedBy]
        : [data.updatedBy, data.createdBy];
  return actors.includes(uid) ? at : null;
}

/** Same change by the same person always maps to the same id, so retries never duplicate. */
export const auditDocId = (claim: AuditClaim, uid: string, stamp: number) =>
  createHash("sha256")
    .update(
      [uid, claim.action, claim.targetType, claim.targetId, stamp].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
