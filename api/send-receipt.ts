import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "./_lib/admin";
import { fromAddress, mailer } from "./_lib/mailer";
import { buildReceiptPdf, prettyDate, zmw } from "./_lib/receiptPdf";

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const todayLusaka = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lusaka" }).format(
    new Date(),
  );

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function requireFinanceStaff(req: VercelRequest) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Sign in again and retry.");
  let uid: string;
  try {
    uid = (await adminAuth().verifyIdToken(token)).uid;
  } catch (error) {
    console.error("send-receipt: Firebase ID token verification failed", error);
    throw new HttpError(401, "Your session has expired. Sign in again.");
  }
  // Same source of truth as the Firestore rules: roles/{uid}.
  const role = (await adminDb().doc(`roles/${uid}`).get()).data();
  if (!role || role.active !== true || !["admin", "bizops"].includes(role.role))
    throw new HttpError(
      403,
      "Only Admin and Business Operations can send receipts.",
    );
  return uid;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const uid = await requireFinanceStaff(req);
    const body =
      (typeof req.body === "string" ? JSON.parse(req.body) : req.body) ?? {};
    const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
    const resend = body.resend === true;
    if (!paymentId || paymentId.includes("/"))
      throw new HttpError(400, "paymentId is required.");

    const db = adminDb();
    const paymentSnap = await db.doc(`financePayments/${paymentId}`).get();
    if (!paymentSnap.exists) throw new HttpError(404, "Payment not found.");
    const payment = paymentSnap.data()!;

    const invoiceSnap = await db
      .doc(`financeRecords/${payment.invoiceId}`)
      .get();
    const invoice = invoiceSnap.data();
    if (!invoice || invoice.kind !== "invoice")
      throw new HttpError(404, "The invoice for this payment was not found.");

    // The recipient is ALWAYS the email stored on this invoice's client record.
    // It is never taken from the request, so the endpoint cannot be used to mail arbitrary addresses.
    const client = (await db.doc(`clients/${invoice.clientId}`).get()).data();
    const to = String(client?.email ?? "").trim();
    if (!to)
      throw new HttpError(
        422,
        `${invoice.clientName} has no email address recorded. Add one under Business → Clients, then send the receipt again.`,
      );
    if (!EMAIL.test(to))
      throw new HttpError(
        422,
        `The email on file for ${invoice.clientName} is not valid. Correct it under Business → Clients.`,
      );

    // Reserve (or reuse) a unique, server-generated receipt number for this payment.
    const receiptRef = db.doc(`receipts/${paymentId}`);
    const counterRef = db.doc("counters/receipts");
    const receipt: Record<string, any> = await db.runTransaction(async (tx) => {
      const [existing, counter] = await Promise.all([
        tx.get(receiptRef),
        tx.get(counterRef),
      ]);
      if (existing.exists) return existing.data()!;
      const next = Number(counter.data()?.next ?? 1);
      const data = {
        receiptNumber: `RCT-${String(next).padStart(6, "0")}`,
        paymentId,
        invoiceId: payment.invoiceId,
        status: "pending",
        sendCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: uid,
      };
      tx.set(counterRef, { next: next + 1 });
      tx.set(receiptRef, data);
      return data;
    });

    if (receipt.status === "sent" && !resend)
      throw new HttpError(
        409,
        `Receipt ${receipt.receiptNumber} was already emailed.`,
        {
          receiptNumber: receipt.receiptNumber,
          sentTo: receipt.sentTo,
        },
      );

    // Balance "as at this payment" = payments recorded up to and including this one.
    const all = await db
      .collection("financePayments")
      .where("invoiceId", "==", payment.invoiceId)
      .get();
    const millis = (t: unknown) =>
      (t as Timestamp | undefined)?.toMillis?.() ?? 0;
    const thisAt = millis(payment.createdAt);
    const paidToDate = all.docs
      .filter((d) => d.id === paymentId || millis(d.data().createdAt) < thisAt)
      .reduce((sum, d) => sum + Number(d.data().amountZmw), 0);
    const round2 = (n: number) => Math.round(n * 100) / 100;

    const company = {
      name: process.env.COMPANY_NAME || "B34ST",
      address: process.env.COMPANY_ADDRESS || "",
      email: process.env.COMPANY_EMAIL || fromAddress(),
    };
    const pdf = await buildReceiptPdf({
      receiptNumber: receipt.receiptNumber,
      issuedOn: todayLusaka(),
      company,
      clientName: invoice.clientName,
      invoiceNumber: invoice.number,
      invoiceTitle: invoice.title,
      paymentDate: payment.date,
      method: payment.method,
      reference: payment.reference ?? "",
      amountZmw: payment.amountZmw,
      invoiceTotalZmw: invoice.amountZmw,
      paidToDateZmw: round2(paidToDate),
      balanceZmw: Math.max(0, round2(invoice.amountZmw - paidToDate)),
    });

    const amount = zmw(payment.amountZmw);
    const greeting =
      String(client?.contactName ?? "").trim() || invoice.clientName;
    const subject = `Payment receipt ${receipt.receiptNumber} – ${invoice.number}`;
    const textBody =
      `Dear ${greeting},\n\nThank you. We have received your payment of ${amount} ` +
      `on ${prettyDate(payment.date)} against invoice ${invoice.number}.\n\n` +
      `Your receipt ${receipt.receiptNumber} is attached as a PDF.\n\n` +
      `Kind regards,\n${company.name}`;
    const htmlBody =
      `<p>Dear ${esc(greeting)},</p>` +
      `<p>Thank you. We have received your payment of <strong>${esc(amount)}</strong> on ${esc(prettyDate(payment.date))} against invoice <strong>${esc(invoice.number)}</strong>.</p>` +
      `<p>Your receipt <strong>${esc(receipt.receiptNumber)}</strong> is attached as a PDF.</p>` +
      `<p>Kind regards,<br>${esc(company.name)}</p>`;

    try {
      const info = await mailer().sendMail({
        from: fromAddress(),
        to,
        replyTo: process.env.MAIL_REPLY_TO || undefined,
        subject,
        text: textBody,
        html: htmlBody,
        attachments: [
          {
            filename: `${receipt.receiptNumber}.pdf`,
            content: Buffer.from(pdf),
            contentType: "application/pdf",
          },
        ],
      });
      await receiptRef.update({
        status: "sent",
        sentTo: to,
        sentAt: FieldValue.serverTimestamp(),
        sentBy: uid,
        messageId: info.messageId ?? "",
        sendCount: FieldValue.increment(1),
        lastError: FieldValue.delete(),
      });
    } catch (err) {
      console.error("send-receipt: SMTP failure", err);
      await receiptRef.update({
        status: "failed",
        lastError: "Email provider rejected or could not send the message.",
      });
      throw new HttpError(
        502,
        "The email could not be sent. Check the SMTP settings or try again.",
      );
    }

    await db.collection("auditLogs").add({
      actorId: uid,
      action: resend ? "receipt.resent" : "receipt.sent",
      targetType: "payment",
      targetId: paymentId,
      createdAt: FieldValue.serverTimestamp(),
    });

    return res
      .status(200)
      .json({ ok: true, receiptNumber: receipt.receiptNumber, sentTo: to });
  } catch (err) {
    if (err instanceof HttpError)
      return res.status(err.status).json({ error: err.message, ...err.extra });
    console.error("send-receipt: unexpected error", err);
    return res
      .status(500)
      .json({ error: "Could not send the receipt. Please try again." });
  }
}
