import { auth } from "./firebase";

export type NotifyEvent =
  | "lead.created"
  | "leave.requested"
  | "leave.decided"
  | "task.created"
  | "announcement.created";

/**
 * Asks the server to email the right person about something the signed-in user just did.
 * The server decides who receives it; this only names the event and the record. Best effort:
 * never throws, and a failure never blocks the action that triggered it.
 */
export async function notify(event: NotifyEvent, id: string): Promise<void> {
  try {
    const user = auth.currentUser;
    if (!user) return;
    await fetch("/api/notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ event, id }),
    });
  } catch {
    /* email is a convenience */
  }
}
