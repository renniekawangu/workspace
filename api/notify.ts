import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminAuth, adminDb } from "./_lib/admin";
import { HttpError, readJson, requireStaff } from "./_lib/auth";
import {
  claimEvent,
  isRecent,
  notifyAddress,
  oneLine,
  releaseEvent,
  sendMailSafe,
} from "./_lib/notify";

const EVENTS = ["lead.created", "leave.requested", "leave.decided"] as const;
type EventName = (typeof EVENTS)[number];

async function emailOf(uid: unknown) {
  if (typeof uid !== "string" || !uid) return "";
  try {
    return (await adminAuth().getUser(uid)).email ?? "";
  } catch {
    return "";
  }
}
async function nameOf(uid: string) {
  const profile = (await adminDb().doc(`users/${uid}`).get()).data();
  return oneLine(profile?.name) || (await emailOf(uid)) || "A colleague";
}

/**
 * Staff-triggered notifications. Recipients are NEVER taken from the request: they come from the
 * stored records, and each event is checked against the caller and sent at most once.
 */
async function handle(event: EventName, id: string, uid: string, role: string) {
  const db = adminDb();
  const now = Date.now();
  const key = `${event}:${id}`;

  if (event === "lead.created") {
    if (!["admin", "bizops"].includes(role))
      throw new HttpError(403, "Your role cannot do this.");
    const lead = (await db.doc(`leads/${id}`).get()).data();
    if (!lead || lead.createdBy !== uid || !isRecent(lead.createdAt, now))
      throw new HttpError(403, "Not a lead you just created.");
    if (!(await claimEvent(key))) return { sent: false, duplicate: true };
    const ok = await sendMailSafe({
      to: notifyAddress(),
      subject: `New lead: ${oneLine(lead.company)}`,
      text: `A new lead was added.\n\nCompany: ${oneLine(lead.company)}\nContact: ${oneLine(lead.contactName)}\nEmail: ${oneLine(lead.email) || "-"}\nPhone: ${oneLine(lead.phone) || "-"}\nSource: ${oneLine(lead.source)}\n`,
    });
    if (!ok) await releaseEvent(key);
    return { sent: ok };
  }

  const leave = (await db.doc(`leave/${id}`).get()).data();
  if (!leave) throw new HttpError(404, "Leave request not found.");

  if (event === "leave.requested") {
    if (
      leave.employeeId !== uid ||
      leave.status !== "pending" ||
      !isRecent(leave.createdAt, now)
    )
      throw new HttpError(403, "Not a request you just made.");
    if (!(await claimEvent(key))) return { sent: false, duplicate: true };
    const to = await emailOf(leave.approverId);
    const ok = await sendMailSafe({
      to,
      subject: `Leave request from ${await nameOf(uid)}`,
      text: `${await nameOf(uid)} requested ${oneLine(leave.type)} from ${oneLine(leave.startDate)} to ${oneLine(leave.endDate)} (${Number(leave.days)} days).\n\nReason: ${oneLine(leave.reason)}\n\nReview it in the staff workspace under Leave management.\n`,
    });
    if (!ok) await releaseEvent(key);
    return { sent: ok };
  }

  // leave.decided
  if (
    !["approved", "rejected"].includes(leave.status) ||
    leave.decidedBy !== uid ||
    !isRecent(leave.decidedAt, now)
  )
    throw new HttpError(403, "Not a decision you just made.");
  if (!(await claimEvent(key))) return { sent: false, duplicate: true };
  const to = await emailOf(leave.employeeId);
  const note = oneLine(leave.decisionNote);
  const ok = await sendMailSafe({
    to,
    subject: `Your leave request was ${leave.status}`,
    text: `Your ${oneLine(leave.type)} request (${oneLine(leave.startDate)} to ${oneLine(leave.endDate)}) was ${leave.status}.${note ? `\n\nNote: ${note}` : ""}\n`,
  });
  if (!ok) await releaseEvent(key);
  return { sent: ok };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const { uid, role } = await requireStaff(req);
    const body = readJson(req);
    const event = body.event as EventName;
    const id = typeof body.id === "string" ? body.id : "";
    if (!EVENTS.includes(event) || !/^[A-Za-z0-9_\-]{1,150}$/.test(id))
      throw new HttpError(400, "Invalid notification.");
    return res
      .status(200)
      .json({ ok: true, ...(await handle(event, id, uid, role)) });
  } catch (err) {
    if (err instanceof HttpError)
      return res.status(err.status).json({ error: err.message, ...err.extra });
    console.error("notify: unexpected error", err);
    return res.status(500).json({ error: "Could not send the notification." });
  }
}
