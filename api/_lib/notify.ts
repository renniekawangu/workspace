import { adminDb } from "./admin";
import { fromAddress, mailer } from "./mailer";

/** Where operational alerts go (new intake, new lead, overdue digest). */
export const notifyAddress = () =>
  process.env.NOTIFY_EMAIL || process.env.COMPANY_EMAIL || fromAddress();

export const oneLine = (s: unknown) =>
  String(s ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();

/** Email is a convenience, never a reason to fail the request. */
export async function sendMailSafe(opts: {
  to: string;
  subject: string;
  text: string;
}) {
  if (!opts.to) return false;
  try {
    await mailer().sendMail({
      from: fromAddress(),
      replyTo: process.env.MAIL_REPLY_TO || undefined,
      to: opts.to,
      subject: oneLine(opts.subject).slice(0, 200),
      text: opts.text,
    });
    return true;
  } catch (err) {
    console.error("notify: SMTP failure", err);
    return false;
  }
}

/** Marks an event as handled. Returns false if it was already handled (so no duplicate email). */
export async function claimEvent(key: string) {
  try {
    await adminDb()
      .doc(`mailLog/${key.replace(/[/\s]/g, "_")}`)
      .create({ at: new Date() });
    return true;
  } catch (e) {
    if ((e as { code?: number }).code === 6) return false;
    throw e;
  }
}
export const releaseEvent = (key: string) =>
  adminDb()
    .doc(`mailLog/${key.replace(/[/\s]/g, "_")}`)
    .delete()
    .catch(() => undefined);

export const isRecent = (
  ts: unknown,
  nowMs: number,
  windowMs = 10 * 60 * 1000,
) => {
  const at = (ts as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
  return at > 0 && at >= nowMs - windowMs && at <= nowMs + 60_000;
};
