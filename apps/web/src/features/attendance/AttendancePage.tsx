import { todayKey } from "../../lib/format";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { useAuth } from "../../app/AuthProvider";
import { writeAudit } from "../../lib/audit";
import { loadUsers, type Profile } from "../../lib/data";
import { db } from "../../lib/firebase";
import { canReviewLeave } from "../../lib/roles";
import { useToast } from "../../lib/toast";
import {
  Button,
  EmptyState,
  ErrorNote,
  LoadingState,
  PageHeader,
  StatusPill,
  type Tone,
} from "../../lib/ui";

type RecordItem = {
  id: string;
  employeeId: string;
  dateKey: string;
  checkInAt?: { toDate: () => Date };
  checkOutAt?: { toDate: () => Date };
};


const showTime = (v?: { toDate: () => Date }) =>
  v
    ? v.toDate().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lusaka" })
    : "—";

function rowStatus(item: RecordItem): { label: string; tone: Tone } {
  if (item.checkOutAt) return { label: "Complete", tone: "green" };
  if (item.checkInAt) return { label: "In progress", tone: "blue" };
  return { label: "—", tone: "slate" };
}

export function AttendancePage() {
  const { user, role } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<RecordItem[]>([]);
  const [staffById, setStaffById] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = todayKey();

  const todayRecord = useMemo(
    () => items.find((x) => x.dateKey === today && x.employeeId === user?.uid),
    [items, today, user],
  );

  const load = useCallback(async () => {
    if (!user || !role) return;
    setLoading(true);
    setError("");
    try {
      const q =
        canReviewLeave(role)
          ? query(
              collection(db, "attendance"),
              orderBy("dateKey", "desc"),
              limit(150),
            )
          : query(
              collection(db, "attendance"),
              where("employeeId", "==", user.uid),
            );
      const snap = await getDocs(q);
      const rows = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as RecordItem,
      );
      const ownId = `${user.uid}_${today}`;
      if (!rows.some((row) => row.id === ownId)) {
        const own = await getDoc(doc(db, "attendance", ownId));
        if (own.exists())
          rows.unshift({ id: own.id, ...own.data() } as RecordItem);
      }
      setItems(rows);
    } catch {
      setError(
        "Attendance records could not be loaded. Check your connection or access permissions.",
      );
    } finally {
      setLoading(false);
    }
  }, [user, role, today]);

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

  const mine = useMemo(
    () => items.filter((x) => x.employeeId === user?.uid),
    [items, user],
  );
  const completed = mine.filter((x) => x.checkOutAt).length;

  const currentLabel = todayRecord?.checkOutAt
    ? "Complete"
    : todayRecord
      ? "Working"
      : "Not checked in";

  const currentTone: Tone = todayRecord?.checkOutAt
    ? "green"
    : todayRecord
      ? "blue"
      : "amber";

  async function checkIn() {
    if (!user || busy || todayRecord) return;
    setBusy(true);
    setError("");
    try {
      const id = `${user.uid}_${today}`;
      await setDoc(doc(db, "attendance", id), {
        employeeId: user.uid,
        dateKey: today,
        checkInAt: serverTimestamp(),
        checkOutAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeAudit(user.uid, "attendance.checked_in", "attendance", id);
      await load();
      toast("Checked in for today.", "success");
    } catch {
      setError("Check-in failed. You may already have a record for today.");
    } finally {
      setBusy(false);
    }
  }

  async function checkOut() {
    if (!user || !todayRecord || todayRecord.checkOutAt || busy) return;
    setBusy(true);
    setError("");
    try {
      await updateDoc(doc(db, "attendance", todayRecord.id), {
        checkOutAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeAudit(
        user.uid,
        "attendance.checked_out",
        "attendance",
        todayRecord.id,
      );
      await load();
      toast("Checked out for today.", "success");
    } catch {
      setError("Check-out failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-7">
      <PageHeader
        eyebrow="People & HR"
        title="Attendance"
        description="Check in and out for the day. Records are append-only and are not proof of physical location."
        actions={
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <div className="panel p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-400">
                Today · {today}
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">
                Your day status
              </h2>
            </div>
            <StatusPill tone={currentTone}>{currentLabel}</StatusPill>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <p className="text-xs text-slate-500">Check-in</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {showTime(todayRecord?.checkInAt)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <p className="text-xs text-slate-500">Check-out</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {showTime(todayRecord?.checkOutAt)}
              </p>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-400">
            {todayRecord?.checkOutAt
              ? "Your day is recorded as complete."
              : todayRecord
                ? "You are checked in. Remember to check out at the end of your day."
                : "You have not checked in today."}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              disabled={busy || !!todayRecord}
              onClick={() => void checkIn()}
            >
              {busy && !todayRecord ? "Checking in…" : "Check in"}
            </Button>
            <Button
              variant="subtle"
              disabled={busy || !todayRecord || !!todayRecord.checkOutAt}
              onClick={() => void checkOut()}
            >
              {busy && todayRecord && !todayRecord.checkOutAt
                ? "Checking out…"
                : "Check out"}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <div className="metric-card">
            <p className="text-xs text-slate-500">Your records loaded</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {loading ? "—" : mine.length}
            </p>
          </div>
          <div className="metric-card">
            <p className="text-xs text-slate-500">Completed days</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-300">
              {loading ? "—" : completed}
            </p>
          </div>
          <div className="metric-card">
            <p className="text-xs text-slate-500">Current status</p>
            <p className="mt-2 text-lg font-semibold text-white">
              {currentLabel}
            </p>
          </div>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-slate-800 px-5 py-4">
          <h2 className="font-semibold text-white">
            {canReviewLeave(role)
              ? "Recent attendance records"
              : "Your attendance history"}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {canReviewLeave(role)
              ? "Latest records across the team"
              : "Your most recent 60 records"}
          </p>
        </div>

        {loading ? (
          <div className="p-5">
            <LoadingState label="Loading records…" rows={4} />
          </div>
        ) : !items.length ? (
          <div className="p-5">
            <EmptyState
              title="No attendance records yet"
              text="Check in to create your first record for today."
              action={
                !todayRecord ? (
                  <Button disabled={busy} onClick={() => void checkIn()}>
                    Check in now
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900/60 text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-3">Date</th>
                  {canReviewLeave(role) && <th className="px-5 py-3">Staff</th>}
                  <th className="px-5 py-3">Check-in</th>
                  <th className="px-5 py-3">Check-out</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => {
                  const status = rowStatus(x);
                  return (
                    <tr key={x.id} className="border-t border-slate-800/70">
                      <td className="px-5 py-4 text-slate-200">{x.dateKey}</td>
                      {canReviewLeave(role) && (
                        <td className="px-5 py-4 text-slate-300">
                          {staffName(x.employeeId)}
                        </td>
                      )}
                      <td className="px-5 py-4 text-slate-300">
                        {showTime(x.checkInAt)}
                      </td>
                      <td className="px-5 py-4 text-slate-300">
                        {showTime(x.checkOutAt)}
                      </td>
                      <td className="px-5 py-4">
                        <StatusPill tone={status.tone}>
                          {status.label}
                        </StatusPill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
