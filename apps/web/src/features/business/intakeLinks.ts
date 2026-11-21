import type { IntakeData } from "./intake";

/** Field builders for turning an intake into a lead, client or project. Timestamps are added by the caller. */

const first = (s: string) => s.split(",")[0].trim();
const cut = (s: string, n: number) => s.slice(0, n);

export function leadFields(d: IntakeData) {
  return {
    company: cut(d.businessName, 160),
    contactName: cut(d.contactName || d.businessName, 160),
    email: cut(d.email, 254),
    phone: cut(d.whatsapp || d.phone, 40),
    source: "Website",
    notes: cut(`Website intake: ${d.whatTheyDo}`, 3000),
    nextFollowUpAt: "",
  };
}

export function clientFields(d: IntakeData) {
  return {
    company: cut(d.businessName, 160),
    contactName: cut(d.contactName || d.businessName, 160),
    email: cut(d.email, 254),
    phone: cut(d.whatsapp || d.phone, 40),
    industry: cut(first(d.categories), 160),
    status: "active" as const,
    notes: "Created from a website intake.",
  };
}

export function addDays(key: string, n: number) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** `today` is a YYYY-MM-DD key. A deadline typed as a date is used; anything else defaults to 30 days. */
export function projectFields(
  d: IntakeData,
  clientId: string,
  uid: string,
  today: string,
) {
  const typed = /^\d{4}-\d{2}-\d{2}$/.test(d.deadline.trim())
    ? d.deadline.trim()
    : "";
  return {
    name: cut(`${d.businessName} website`, 160),
    clientId,
    clientName: cut(d.businessName, 160),
    description: cut(
      `Website build for ${d.businessName}. ${d.whatTheyDo}${d.deadline && !typed ? `\n\nClient deadline: ${d.deadline}` : ""}`,
      4000,
    ),
    status: "planning" as const,
    priority: "medium" as const,
    startDate: today,
    dueDate: typed && typed >= today ? typed : addDays(today, 30),
    managerId: uid,
    memberIds: [uid],
    milestones: [] as never[],
  };
}
