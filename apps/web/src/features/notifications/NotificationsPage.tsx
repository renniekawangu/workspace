import { todayKey } from "../../lib/format";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { db } from "../../lib/firebase";
import {
  canCreateDigitalContent,
  canManageBusiness,
  canManageDigital,
} from "../../lib/roles";
import {
  Button,
  EmptyState,
  ErrorNote,
  LoadingState,
  PageHeader,
  StatusPill,
  type Tone,
} from "../../lib/ui";

type Severity = "urgent" | "attention" | "info";
type AlertItem = {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  href: string;
  group: string;
};

type Row = Record<string, unknown> & { id: string };

const today = () => todayKey();

function severityTone(severity: Severity): Tone {
  if (severity === "urgent") return "red";
  if (severity === "attention") return "amber";
  return "blue";
}

export function NotificationsPage() {
  const { user, role } = useAuth();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");

  const load = useCallback(async () => {
    if (!user || !role) return;
    setLoading(true);
    setError("");
    try {
      const failed: string[] = [];
      const read = async (
        key: string,
        name: string,
        filters: QueryConstraint[] = [],
      ): Promise<{ key: string; rows: Row[] }> => {
        try {
          const snap = await getDocs(
            query(collection(db, name), ...filters, limit(200)),
          );
          return {
            key,
            rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          };
        } catch {
          failed.push(name);
          return { key, rows: [] };
        }
      };

      const jobs: Array<Promise<{ key: string; rows: Row[] }>> = [
        read("tasks", "tasks", [where("assigneeId", "==", user.uid)]),
        // Admins are the fallback approver and can read every request.
        read(
          "leave",
          "leave",
          role === "admin"
            ? [where("status", "==", "pending")]
            : [where("approverId", "==", user.uid)],
        ),
      ];
      if (canManageBusiness(role)) {
        jobs.push(read("finance", "financeRecords"));
        jobs.push(read("projects", "projects"));
      }
      if (canManageDigital(role)) {
        jobs.push(read("posts", "socialPosts"));
        jobs.push(read("requests", "websiteRequests"));
      }
      if (canCreateDigitalContent(role) && role === "designer") {
        jobs.push(
          read("posts", "socialPosts", [where("createdBy", "==", user.uid)]),
        );
      }

      const result = await Promise.all(jobs);
      const byKey: Record<string, Row[]> = {};
      for (const r of result) byKey[r.key] = r.rows;
      const next: AlertItem[] = [];
      const now = today();

      for (const r of byKey.leave || []) {
        if (r.status !== "pending") continue;
        next.push({
          id: `leave-${r.id}`,
          title: "Leave request awaiting your decision",
          detail: `${String(r.type)} · ${String(r.startDate)} to ${String(r.endDate)}`,
          severity: "attention",
          href: "/leave",
          group: "Leave",
        });
      }

      for (const r of byKey.tasks || []) {
        if (r.status === "done") continue;
        next.push({
          id: `task-${r.id}`,
          title: "Assigned task still open",
          detail: String(r.title || "Untitled task"),
          severity: r.status === "todo" ? "attention" : "info",
          href: "/tasks",
          group: "Tasks",
        });
      }

      for (const r of byKey.finance || []) {
        if (r.kind !== "invoice" || r.status === "void") continue;
        const amount = Number(r.amountZmw || 0);
        const paid = Number(r.paidAmountZmw || 0);
        const due = String(r.dueDate || "");
        if (amount - paid > 0 && due && due < now) {
          next.push({
            id: `invoice-${r.id}`,
            title: "Overdue invoice",
            detail: `${String(r.number || r.title || "Invoice")} · ${String(r.clientName || "")}`,
            severity: "urgent",
            href: "/finance",
            group: "Finance",
          });
        }
      }

      for (const r of byKey.projects || []) {
        const due = String(r.dueDate || "");
        if (due && due < now && r.status !== "completed") {
          next.push({
            id: `project-${r.id}`,
            title: "Overdue project",
            detail: String(r.name || "Project"),
            severity: "urgent",
            href: "/projects",
            group: "Projects",
          });
        }
      }

      for (const r of byKey.posts || []) {
        // Only admins can approve content, so only they are asked to.
        if (r.status === "pending_approval" && role === "admin") {
          next.push({
            id: `post-${r.id}`,
            title: "Content awaiting approval",
            detail: String(r.title || "Untitled post"),
            severity: "attention",
            href: "/digital",
            group: "Content",
          });
        }
        const scheduled = String(r.scheduledAt || "").slice(0, 10);
        if (r.status === "scheduled" && scheduled && scheduled <= now) {
          next.push({
            id: `post-due-${r.id}`,
            title: "Scheduled content is due",
            detail: String(r.title || "Untitled post"),
            severity: "attention",
            href: role === "designer" ? "/design" : "/digital",
            group: "Content",
          });
        }
      }

      for (const r of byKey.requests || []) {
        if (["completed", "rejected"].includes(String(r.status))) continue;
        next.push({
          id: `webreq-${r.id}`,
          title: "Open website request",
          detail: String(r.title || "Website change"),
          severity: "info",
          href: "/digital",
          group: "Website",
        });
      }

      const order: Record<Severity, number> = {
        urgent: 0,
        attention: 1,
        info: 2,
      };
      next.sort((a, b) => order[a.severity] - order[b.severity]);
      setAlerts(next);
      if (failed.length)
        setError(
          `Some sources could not be checked (${failed.join(", ")}), so this list may be incomplete.`,
        );
    } catch {
      setError("Notifications could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [user, role]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const set = new Set(alerts.map((a) => a.group));
    return ["all", ...[...set].sort()];
  }, [alerts]);

  const visible = useMemo(
    () =>
      groupFilter === "all"
        ? alerts
        : alerts.filter((a) => a.group === groupFilter),
    [alerts, groupFilter],
  );

  const counts = useMemo(() => {
    const base = { all: alerts.length, urgent: 0, attention: 0, info: 0 };
    for (const a of alerts) base[a.severity] += 1;
    return base;
  }, [alerts]);

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="Attention centre"
        title="Notifications"
        description="Derived from records you can already access. No push or email — refresh to update."
        actions={
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="metric-card">
          <p className="text-xs text-slate-500">Open items</p>
          <p className="mt-2 text-2xl font-semibold text-white">{counts.all}</p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-slate-500">Urgent</p>
          <p className="mt-2 text-2xl font-semibold text-rose-300">
            {counts.urgent}
          </p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-slate-500">Needs attention</p>
          <p className="mt-2 text-2xl font-semibold text-amber-200">
            {counts.attention}
          </p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-slate-500">Info</p>
          <p className="mt-2 text-2xl font-semibold text-sky-300">
            {counts.info}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {groups.map((group) => {
          const active = groupFilter === group;
          return (
            <button
              key={group}
              type="button"
              onClick={() => setGroupFilter(group)}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition ${
                active
                  ? "border-sky-400/40 bg-sky-400/10 text-sky-200"
                  : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
              }`}
            >
              {group === "all" ? "All" : group}
            </button>
          );
        })}
      </div>

      {loading ? (
        <LoadingState label="Loading notifications…" rows={4} />
      ) : visible.length === 0 ? (
        <EmptyState
          title="You're all caught up"
          text="No open leave decisions, overdue work, or pending approvals matched your account."
        />
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <Link
              key={item.id}
              to={item.href}
              className="panel block p-4 transition hover:border-slate-600"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {item.group}
                  </p>
                  <h3 className="mt-1 font-semibold text-white">{item.title}</h3>
                  <p className="mt-1 text-sm text-slate-400">{item.detail}</p>
                </div>
                <StatusPill tone={severityTone(item.severity)}>
                  {item.severity}
                </StatusPill>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
