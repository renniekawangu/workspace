import { timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "./_lib/admin";
import {
  claimEvent,
  notifyAddress,
  oneLine,
  releaseEvent,
  sendMailSafe,
} from "./_lib/notify";

const todayLusaka = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lusaka" }).format(
    new Date(),
  );
const money = (n: number) =>
  `ZMW ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayDiff = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );

function authorised(req: VercelRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never run open
  const given = Buffer.from(String(req.headers.authorization ?? ""));
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Vercel Cron (daily). Emails one digest of unpaid invoices past their due date. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed." });
  if (!authorised(req)) return res.status(401).json({ error: "Unauthorised." });
  try {
    const today = todayLusaka();
    const snap = await adminDb()
      .collection("financeRecords")
      .where("kind", "==", "invoice")
      .limit(2000)
      .get();
    const overdue = snap.docs
      .map((d) => d.data())
      .map((x) => ({
        number: oneLine(x.number),
        client: oneLine(x.clientName),
        due: String(x.dueDate ?? ""),
        balance:
          Math.round((Number(x.amountZmw) - Number(x.paidAmountZmw)) * 100) /
          100,
        status: String(x.status),
      }))
      .filter(
        (x) =>
          x.status !== "void" &&
          x.balance > 0.005 &&
          /^\d{4}-\d{2}-\d{2}$/.test(x.due) &&
          x.due < today,
      )
      .sort((a, b) => a.due.localeCompare(b.due));
    if (!overdue.length)
      return res.status(200).json({ ok: true, sent: false, overdue: 0 });

    const key = `overdue:${today}`;
    if (!(await claimEvent(key)))
      return res.status(200).json({ ok: true, sent: false, duplicate: true });
    const total = overdue.reduce((s, x) => s + x.balance, 0);
    const lines = overdue
      .slice(0, 25)
      .map(
        (x) =>
          `- ${x.number} | ${x.client} | ${money(x.balance)} | due ${x.due} (${dayDiff(x.due, today)} days late)`,
      );
    const ok = await sendMailSafe({
      to: notifyAddress(),
      subject: `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"} (${money(total)})`,
      text: `Unpaid invoices past their due date as of ${today}:\n\n${lines.join("\n")}${overdue.length > 25 ? `\n...and ${overdue.length - 25} more` : ""}\n\nTotal outstanding on these: ${money(total)}\nOpen Finance in the staff workspace to follow up.\n`,
    });
    if (!ok) await releaseEvent(key);
    return res
      .status(200)
      .json({ ok: true, sent: ok, overdue: overdue.length });
  } catch (err) {
    console.error("cron-overdue: unexpected error", err);
    return res.status(500).json({ error: "Could not run the overdue check." });
  }
}
