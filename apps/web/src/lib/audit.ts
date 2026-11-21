import { auth } from "./firebase";

/**
 * Records an audit entry through the server (/api/audit). Clients cannot write auditLogs
 * directly: the server checks that the target document was really changed by this user a
 * moment ago, and takes the actor from the verified token, so `_actorId` is not trusted.
 *
 * Never throws: the change you are auditing has already been saved, and a failed log must not
 * show the user a false "could not save" error. Returns whether the entry was recorded.
 */
export async function writeAudit(
  _actorId: string,
  action: string,
  targetType: string,
  targetId: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const user = auth.currentUser;
      if (!user) return false;
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({ action, targetType, targetId }),
      });
      if (res.ok) return true;
      if (res.status < 500) break; // rejected, retrying will not help
    } catch {
      /* network error: retry once */
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  console.warn(`Audit entry not recorded: ${action} ${targetType}/${targetId}`);
  return false;
}
