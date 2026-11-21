import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { useAuth } from "../../app/AuthProvider";
import { writeAudit } from "../../lib/audit";
import { notify } from "../../lib/notify";
import { loadUsers, type Profile } from "../../lib/data";
import { db } from "../../lib/firebase";
import { canReviewLeave } from "../../lib/roles";
import { useToast } from "../../lib/toast";
import {
  Button,
  EmptyState,
  ErrorNote,
  LoadingState,
  Modal,
  PageHeader,
  SelectField,
  StatusPill,
  TextAreaField,
  TextField,
  type Tone,
} from "../../lib/ui";

type LeaveItem = {
  id: string;
  employeeId: string;
  approverId: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  decisionNote?: string;
};

const leaveTypes = [
  "Annual leave",
  "Sick leave",
  "Family responsibility",
  "Unpaid leave",
  "Other",
];

function statusTone(status: LeaveItem["status"]): Tone {
  if (status === "approved") return "green";
  if (status === "rejected") return "red";
  return "amber";
}

export function LeavePage() {
  const { user, role } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<LeaveItem[]>([]);
  const [staffById, setStaffById] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [type, setType] = useState(leaveTypes[0]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">(
    "all",
  );

  const load = useCallback(async () => {
    if (!user || !role) return;
    setLoading(true);
    setError("");
    try {
      if (canReviewLeave(role)) {
        const snap = await getDocs(
          query(
            collection(db, "leave"),
            orderBy("createdAt", "desc"),
            limit(150),
          ),
        );
        setItems(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LeaveItem),
        );
      } else {
        const [own, assigned] = await Promise.all([
          getDocs(
            query(
              collection(db, "leave"),
              where("employeeId", "==", user.uid),
            ),
          ),
          getDocs(
            query(
              collection(db, "leave"),
              where("approverId", "==", user.uid),
            ),
          ),
        ]);
        const merged = new Map<string, LeaveItem>();
        for (const d of [...own.docs, ...assigned.docs]) {
          merged.set(d.id, { id: d.id, ...d.data() } as LeaveItem);
        }
        setItems(
          [...merged.values()].sort((a, b) =>
            b.startDate.localeCompare(a.startDate),
          ),
        );
      }
    } catch {
      setError(
        "Leave requests could not be loaded. Check your connection or access permissions.",
      );
    } finally {
      setLoading(false);
    }
  }, [user, role]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadUsers()
      .then((profiles) => {
        const map: Record<string, Profile> = {};
        for (const profile of profiles) map[profile.id] = profile;
        setStaffById(map);
      })
      .catch(() => setStaffById({}));
  }, []);

  const staffName = (id: string) =>
    staffById[id]?.name || staffById[id]?.workEmail || id;

  const days = useMemo(() => {
    if (!start || !end || end < start) return 0;
    return (
      Math.floor(
        (Date.parse(`${end}T00:00:00Z`) -
          Date.parse(`${start}T00:00:00Z`)) /
          86_400_000,
      ) + 1
    );
  }, [start, end]);

  const pending = items.filter((x) => x.status === "pending").length;
  const awaitingMe = items.filter(
    (x) =>
      x.status === "pending" &&
      x.approverId === user?.uid &&
      x.employeeId !== user?.uid,
  ).length;

  const visible = useMemo(
    () => items.filter((x) => filter === "all" || x.status === filter),
    [items, filter],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user || busy || !days || !reason.trim()) return;
    const clash = items.find(
      (x) =>
        x.employeeId === user.uid &&
        (x.status === "pending" || x.status === "approved") &&
        x.startDate <= end &&
        x.endDate >= start,
    );
    if (clash) {
      setError(
        `You already have a ${clash.status} request from ${clash.startDate} to ${clash.endDate} that overlaps these dates.`,
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const profile = await getDoc(doc(db, "userPrivate", user.uid));
      const approverId = String(profile.data()?.reportsTo || "");
      if (!approverId) throw new Error("MISSING_APPROVER");
      const ref = await addDoc(collection(db, "leave"), {
        employeeId: user.uid,
        approverId,
        type,
        startDate: start,
        endDate: end,
        days,
        reason: reason.trim(),
        status: "pending",
        decisionNote: "",
        decidedBy: "",
        decidedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeAudit(user.uid, "leave.requested", "leave", ref.id);
      void notify("leave.requested", ref.id);
      setStart("");
      setEnd("");
      setReason("");
      setType(leaveTypes[0]);
      setRequestOpen(false);
      await load();
      toast("Your leave request has been submitted for approval.", "success");
    } catch (err) {
      setError(
        err instanceof Error && err.message === "MISSING_APPROVER"
          ? "Your profile does not have a reporting manager set. Ask an administrator to update your Reports To field before applying."
          : "Your request could not be submitted. Please check your profile and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function decide(item: LeaveItem, status: "approved" | "rejected") {
    if (!user || busy || item.employeeId === user.uid) return;
    setBusy(true);
    setError("");
    try {
      await updateDoc(doc(db, "leave", item.id), {
        status,
        decisionNote: (decision[item.id] || "").trim(),
        decidedBy: user.uid,
        decidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeAudit(user.uid, `leave.${status}`, "leave", item.id);
      void notify("leave.decided", item.id);
      await load();
      toast(
        status === "approved" ? "Leave approved." : "Leave rejected.",
        "success",
      );
    } catch {
      setError(
        "This request could not be updated. Only its authorised approver or an administrator can decide it.",
      );
    } finally {
      setBusy(false);
    }
  }

  const canDecide = (item: LeaveItem) =>
    !!user &&
    item.status === "pending" &&
    item.employeeId !== user.uid &&
    (canReviewLeave(role) || item.approverId === user.uid);

  return (
    <section className="space-y-7">
      <PageHeader
        eyebrow="People & HR"
        title="Leave management"
        description="Submit leave requests and track decisions in one place. Duration counts inclusive calendar days (weekends included)."
        actions={
          <Button
            onClick={() => {
              setError("");
              setRequestOpen(true);
            }}
          >
            Request leave
          </Button>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="metric-card">
          <p className="text-xs text-slate-500">Visible requests</p>
          <p className="mt-2 text-2xl font-semibold text-white">
            {items.length}
          </p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-slate-500">Pending</p>
          <p className="mt-2 text-2xl font-semibold text-amber-200">
            {pending}
          </p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-slate-500">Awaiting your decision</p>
          <p className="mt-2 text-2xl font-semibold text-sky-300">
            {awaitingMe}
          </p>
        </div>
      </div>

      <div className="panel p-4 sm:max-w-xs">
        <SelectField
          label="Filter"
          value={filter}
          onChange={(e) =>
            setFilter(
              e.target.value as "all" | "pending" | "approved" | "rejected",
            )
          }
          options={[
            { value: "all", label: "All statuses" },
            { value: "pending", label: "Pending" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
          ]}
        />
      </div>

      {loading ? (
        <LoadingState label="Loading leave requests…" rows={4} />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No leave requests found"
          text={
            filter === "all"
              ? "Submit a request to get started, or wait for assigned approvals to appear."
              : "Nothing in this status. Try another filter."
          }
          action={
            filter === "all" ? (
              <Button onClick={() => setRequestOpen(true)}>Request leave</Button>
            ) : (
              <Button variant="ghost" onClick={() => setFilter("all")}>
                Show all
              </Button>
            )
          }
        />
      ) : (
        <div className="panel overflow-hidden">
          <div className="border-b border-slate-800 px-5 py-4">
            <h2 className="font-semibold text-white">
              {canReviewLeave(role)
                ? "Leave requests for administration"
                : "Your leave requests & approvals"}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {canReviewLeave(role)
                ? "Admin review across the organisation"
                : "Your requests and requests assigned to you for approval"}
            </p>
          </div>
          <div className="divide-y divide-slate-800/70">
            {visible.map((item) => (
              <article key={item.id} className="space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-white">{item.type}</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      {item.startDate} → {item.endDate} · {item.days} calendar
                      day{item.days === 1 ? "" : "s"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Employee: {staffName(item.employeeId)}
                      {item.approverId
                        ? ` · Approver: ${staffName(item.approverId)}`
                        : ""}
                    </p>
                  </div>
                  <StatusPill tone={statusTone(item.status)}>
                    {item.status}
                  </StatusPill>
                </div>

                <p className="text-sm leading-6 text-slate-400">
                  {item.reason}
                </p>

                {item.decisionNote && (
                  <p className="rounded-lg bg-slate-900/70 p-3 text-xs text-slate-400">
                    Decision note: {item.decisionNote}
                  </p>
                )}

                {canDecide(item) && (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1">
                      <TextField
                        label="Decision note (optional)"
                        value={decision[item.id] || ""}
                        onChange={(e) =>
                          setDecision((s) => ({
                            ...s,
                            [item.id]: e.target.value,
                          }))
                        }
                        placeholder="Optional note for the employee"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => void decide(item, "rejected")}
                      >
                        Reject
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => void decide(item, "approved")}
                      >
                        Approve
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {requestOpen && (
        <Modal
          title="Request leave"
          onClose={() => !busy && setRequestOpen(false)}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setRequestOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="leave-request-form"
                disabled={busy || !days || !reason.trim()}
              >
                {busy ? "Submitting…" : "Submit request"}
              </Button>
            </>
          }
        >
          <form
            id="leave-request-form"
            onSubmit={submit}
            className="grid gap-4"
          >
            <SelectField
              label="Leave type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              options={leaveTypes.map((value) => ({ value, label: value }))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Start date"
                type="date"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <TextField
                label="End date"
                type="date"
                required
                min={start || undefined}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm">
              <p className="text-xs text-slate-500">Requested duration</p>
              <p className="mt-1 font-medium text-white">
                {days > 0
                  ? `${days} calendar day${days === 1 ? "" : "s"}`
                  : "Select a valid date range"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Inclusive of start and end dates. Weekends are counted; public
                holidays are not deducted automatically.
              </p>
            </div>
            <TextAreaField
              label="Reason"
              required
              rows={4}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              hint="Your manager and administrators can see this note."
            />
          </form>
        </Modal>
      )}
    </section>
  );
}
