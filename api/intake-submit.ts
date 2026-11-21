import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FieldValue } from "firebase-admin/firestore";
import {
  buildSummary,
  cleanIntake,
  sanitizeIntake,
  validateIntake,
} from "../shared/intake";
import { adminDb } from "./_lib/admin";
import { HttpError, readJson } from "./_lib/auth";
import { notifyAddress, oneLine, sendMailSafe } from "./_lib/notify";

const MAX_BODY_CHARS = 60_000;
const PER_IP_PER_HOUR = 5;
const PER_DAY_TOTAL = 300;
const MIN_FILL_MS = 2500;

/** Same-origin requests and origins listed in INTAKE_ALLOWED_ORIGINS (comma separated). */
function allowedOrigin(req: VercelRequest) {
  const origin = String(req.headers.origin ?? "");
  if (!origin) return { origin: "", ok: true };
  const list = (process.env.INTAKE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let sameHost = false;
  try {
    sameHost = new URL(origin).host === req.headers.host;
  } catch {
    /* malformed origin */
  }
  return { origin, ok: sameHost || list.includes(origin) };
}

const clientIp = (req: VercelRequest) =>
  String(req.headers["x-forwarded-for"] ?? "")
    .split(",")[0]
    .trim() ||
  req.socket?.remoteAddress ||
  "unknown";

async function takeSlot(ipHash: string) {
  const db = adminDb();
  const now = new Date();
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  const ipRef = db.doc(`rateLimits/${ipHash}_${hour}`);
  const dayRef = db.doc(`rateLimits/all_${day}`);
  await db.runTransaction(async (tx) => {
    const [ip, all] = await Promise.all([tx.get(ipRef), tx.get(dayRef)]);
    if (Number(ip.data()?.count ?? 0) >= PER_IP_PER_HOUR)
      throw new HttpError(429, "Too many submissions. Please try again later.");
    if (Number(all.data()?.count ?? 0) >= PER_DAY_TOTAL)
      throw new HttpError(
        429,
        "We are receiving a lot of requests. Please try again tomorrow.",
      );
    tx.set(
      ipRef,
      { count: Number(ip.data()?.count ?? 0) + 1, at: now },
      { merge: true },
    );
    tx.set(
      dayRef,
      { count: Number(all.data()?.count ?? 0) + 1, at: now },
      { merge: true },
    );
  });
}

/**
 * PUBLIC endpoint: a client submits their website brief. It writes only to `intakes` (as
 * source "client_form", status "new") and never emails the submitted address, so it cannot be
 * used to mail strangers.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  const { origin, ok: originOk } = allowedOrigin(req);
  if (origin && originOk) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.status(originOk ? 204 : 403).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    if (!originOk)
      throw new HttpError(
        403,
        "This site is not allowed to send requests here.",
      );
    const body = readJson(req);
    if (JSON.stringify(body).length > MAX_BODY_CHARS)
      throw new HttpError(413, "That submission is too large.");
    // Bots fill the hidden field or submit instantly. Pretend success so they learn nothing.
    if (typeof body.hp === "string" && body.hp.trim())
      return res.status(200).json({ ok: true, reference: "-" });
    if (typeof body.elapsedMs === "number" && body.elapsedMs < MIN_FILL_MS)
      return res.status(200).json({ ok: true, reference: "-" });

    const data = cleanIntake(sanitizeIntake(body.data));
    const fields = validateIntake(data);
    if (Object.keys(fields).length)
      throw new HttpError(400, "Please check the highlighted fields.", {
        fields,
      });

    const salt =
      process.env.INTAKE_SALT || process.env.FIREBASE_PROJECT_ID || "b34st";
    await takeSlot(
      createHash("sha256")
        .update(`${salt}|${clientIp(req)}`)
        .digest("hex")
        .slice(0, 24),
    );

    const db = adminDb();
    const ref = db.collection("intakes").doc();
    await ref.set({
      ...data,
      status: "new",
      source: "client_form",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "public",
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "public",
    });
    await db
      .collection("auditLogs")
      .add({
        actorId: "public",
        action: "intake.submitted",
        targetType: "intake",
        targetId: ref.id,
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch((e) => console.error("intake-submit: audit failed", e));

    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    await sendMailSafe({
      to: notifyAddress(),
      subject: `New website intake: ${oneLine(data.businessName)}`,
      text: `A client sent their website details.\n${appUrl ? `\nOpen it: ${appUrl}/business/intake\n` : ""}\n${buildSummary(data)}\n`,
    });
    return res
      .status(200)
      .json({ ok: true, reference: ref.id.slice(0, 8).toUpperCase() });
  } catch (err) {
    if (err instanceof HttpError)
      return res.status(err.status).json({ error: err.message, ...err.extra });
    console.error("intake-submit: unexpected error", err);
    return res.status(500).json({
      error:
        "Could not send your details. Please use the Send by WhatsApp or email option instead.",
    });
  }
}
