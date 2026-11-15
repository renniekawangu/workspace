import { todayKey } from "../../lib/format";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../../app/AuthProvider";
import { DEPARTMENTS, ROLES, type Department, type Role } from "../../lib/enums";
import { useToast } from "../../lib/toast";
import {
  createStaffAccount,
  grantAccessToExistingAccount,
  loadRoster,
  saveStaff,
  sendStaffPasswordReset,
  type StaffRow,
} from "../../lib/userService";
import {
  DEPARTMENT_LABEL,
  ROLE_LABEL,
  deptForRole,
  deptIsFixed,
  generatePassword,
  validateAccessChange,
  validateHrInput,
  validateNewUserInput,
  validateProfileInput,
} from "../../lib/userManagement";
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  EntityPicker,
  ErrorNote,
  LoadingState,
  Modal,
  PageHeader,
  SelectField,
  TextAreaField,
  TextField,
} from "../../lib/ui";

const roleOptions = ROLES.map((value) => ({ value, label: ROLE_LABEL[value] }));
const deptOptions = DEPARTMENTS.map((value) => ({
  value,
  label: DEPARTMENT_LABEL[value],
}));

const displayName = (row: StaffRow) =>
  row.profile?.name || `Unnamed (${row.uid.slice(0, 6)})`;

function errorText(error: unknown, fallback: string) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  if (code === "auth/email-already-in-use")
    return "That email already has an account. Use “Existing account” instead, or pick another email.";
  if (code === "auth/weak-password") return "That password is too weak.";
  if (code === "auth/invalid-email") return "That email address is not valid.";
  if (code === "permission-denied")
    return "The database rejected that change. Makee sure the latest firestore.rules are deployed.";
  return fallback;
}

type Flag = { label: string; tone: "amber" | "red" };
function flagsFor(row: StaffRow): Flag[] {
  const out: Flag[] = [];
  if (!row.profile) out.push({ label: "No profile", tone: "amber" });
  if (!row.access) out.push({ label: "No access", tone: "red" });
  if (row.access?.active && row.hr && !row.hr.reportsTo)
    out.push({ label: "No manager", tone: "amber" });
  if (row.access?.active && !row.hr) out.push({ label: "No HR record", tone: "amber" });
  return out;
}

export function AdminPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [toggling, setToggling] = useState<StaffRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await loadRoster());
    } catch {
      setError("Could not load staff. Check your connection and that the latest firestore.rules are deployed.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const accessRows = useMemo(
    () =>
      rows
        .filter((row) => row.access)
        .map((row) => ({
          uid: row.uid,
          role: row.access!.role,
          active: row.access!.active,
        })),
    [rows],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (roleFilter !== "all" && row.access?.role !== roleFilter) return false;
        if (deptFilter !== "all" && row.access?.dept !== deptFilter) return false;
        if (statusFilter === "active" && !row.access?.active) return false;
        if (statusFilter === "inactive" && row.access?.active) return false;
        if (!term) return true;
        return [
          row.uid,
          row.profile?.name,
          row.profile?.workEmail,
          row.profile?.jobTitle,
          row.access?.role,
        ].some((value) => value?.toLowerCase().includes(term));
      })
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [rows, search, roleFilter, deptFilter, statusFilter]);

  const stats = useMemo(() => {
    const withAccess = rows.filter((row) => row.access);
    return {
      total: rows.length,
      active: withAccess.filter((row) => row.access!.active).length,
      inactive: withAccess.filter((row) => !row.access!.active).length,
      attention: rows.filter((row) => flagsFor(row).length > 0).length,
    };
  }, [rows]);

  async function toggleActive(row: StaffRow) {
    if (!user || !row.access) return;
    const next = !row.access.active;
    const problem = validateAccessChange(
      accessRows,
      { uid: row.uid, role: row.access.role, active: next },
      user.uid,
    );
    if (problem) {
      setToggling(null);
      toast(problem, "error");
      return;
    }
    setBusy(true);
    try {
      await saveStaff({
        uid: row.uid,
        actorUid: user.uid,
        profile: {
          name: row.profile?.name || displayName(row),
          jobTitle: row.profile?.jobTitle ?? "",
          workEmail: row.profile?.workEmail ?? "",
        },
        access: { role: row.access.role, department: row.access.dept, active: next },
        existing: { access: row.access, profile: row.profile },
        fallbackDepartment: row.access.dept,
      });
      toast(next ? "Access restored." : "Access removed.", "success");
      setToggling(null);
      await load();
    } catch (err) {
      toast(errorText(err, "Could not change access."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function reset(row: StaffRow) {
    if (!user || !row.profile?.workEmail) {
      toast("This person has no work email on file.", "error");
      return;
    }
    try {
      await sendStaffPasswordReset(row.profile.workEmail, user.uid, row.uid);
      toast(`Password reset email sent to ${row.profile.workEmail}.`, "success");
    } catch {
      toast("Could not send the reset email.", "error");
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Staff access"
        description="Create accounts, set roles, manage HR details and remove access. Role changes take effect immediately."
        actions={<Button onClick={() => setAdding(true)}>Add staff member</Button>}
      />
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Total", stats.total, "text-white"],
          ["Active", stats.active, "text-emerald-300"],
          ["Inactive", stats.inactive, "text-amber-300"],
          ["Need attention", stats.attention, "text-sky-300"],
        ].map(([label, value, tone]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</p>
            <p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <TextField
            label="Search"
            value={search}
            placeholder="Name, email, title or UID…"
            onChange={(e) => setSearch(e.target.value)}
          />
          <SelectField
            label="Role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            options={[{ value: "all", label: "All roles" }, ...roleOptions]}
          />
          <SelectField
            label="Department"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            options={[{ value: "all", label: "All departments" }, ...deptOptions]}
          />
          <SelectField
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
        </div>
      </Card>

      {loading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState title="No staff match" text="Adjust the filters or add a staff member." />
      ) : (
        <div className="space-y-3">
          {filtered.map((row) => {
            const self = row.uid === user?.uid;
            const flags = flagsFor(row);
            return (
              <Card key={row.uid} className="p-4">
                <div className="flex flex-wrap items-center gap-4">
                  <Avatar name={displayName(row)} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">
                      {displayName(row)} {self && <Badge tone="blue">You</Badge>}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {row.profile?.workEmail || "No email on file"}
                      {row.profile?.jobTitle ? ` · ${row.profile.jobTitle}` : ""}
                    </p>
                    <p className="mt-1 break-all text-[10px] text-slate-600">{row.uid}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {row.access && <Badge tone="blue">{ROLE_LABEL[row.access.role]}</Badge>}
                    {row.access && <Badge>{DEPARTMENT_LABEL[row.access.dept]}</Badge>}
                    {row.access && (
                      <Badge tone={row.access.active ? "green" : "amber"}>
                        {row.access.active ? "Active" : "Inactive"}
                      </Badge>
                    )}
                    {flags.map((flag) => (
                      <Badge key={flag.label} tone={flag.tone}>{flag.label}</Badge>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => setEditing(row)}>Edit</Button>
                    <Button variant="subtle" onClick={() => void reset(row)} disabled={!row.profile?.workEmail}>
                      Reset password
                    </Button>
                    {row.access && !self && (
                      <Button
                        variant={row.access.active ? "danger" : "ghost"}
                        onClick={() => setToggling(row)}
                      >
                        {row.access.active ? "Remove access" : "Restore access"}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {adding && user && (
        <AddStaffModal
          actorUid={user.uid}
          onClose={() => setAdding(false)}
          onDone={async (message) => {
            setAdding(false);
            toast(message, "success");
            await load();
          }}
        />
      )}
      {editing && user && (
        <EditStaffModal
          key={editing.uid}
          row={editing}
          actorUid={user.uid}
          accessRows={accessRows}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            toast("Staff record saved.", "success");
            await load();
          }}
        />
      )}
      {toggling?.access && (
        <ConfirmDialog
          title={toggling.access.active ? "Remove access?" : "Restore access?"}
          message={
            toggling.access.active
              ? `${displayName(toggling)} will be blocked from the workspace immediately. Their records are kept. To fully lock the sign-in itself, also run the disable-user script (it revokes sessions).`
              : `${displayName(toggling)} will be able to sign in and use the workspace again.`
          }
          confirmLabel={toggling.access.active ? "Remove access" : "Restore access"}
          tone={toggling.access.active ? "danger" : "primary"}
          busy={busy}
          onConfirm={() => toggleActive(toggling)}
          onClose={() => setToggling(null)}
        />
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function AddStaffModal({
  actorUid,
  onClose,
  onDone,
}: {
  actorUid: string;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [uid, setUid] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [department, setDepartment] = useState<Department>("technical");
  const [jobTitle, setJobTitle] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    let problem: string;
    if (mode === "new") {
      problem =
        validateNewUserInput({ email, name, password, confirmPassword: confirm }) ||
        validateProfileInput({ name, jobTitle, workEmail: email });
    } else {
      problem =
        (uid.trim().length < 10 ? "Enter the Firebase Auth UID." : "") ||
        validateProfileInput({ name, jobTitle, workEmail: email });
    }
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const profile = { name, jobTitle, workEmail: email };
      if (mode === "new") {
        await createStaffAccount(actorUid, { ...profile, password, role, department });
        await onDone(
          `Created ${email.trim()}. Share the password securely and ask them to reset it on first sign-in.`,
        );
      } else {
        if (uid.trim() === actorUid) throw new Error("self");
        await grantAccessToExistingAccount(actorUid, uid.trim(), { ...profile, role, department });
        await onDone(`Access granted to ${name.trim()}.`);
      }
    } catch (err) {
      setError(
        errorText(
          err,
          err instanceof Error && err.message === "self"
            ? "You cannot change your own access."
            : "The account could not be created. Nothing was saved.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add staff member"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="add-staff-form" disabled={busy}>
            {busy ? "Saving…" : mode === "new" ? "Create account" : "Grant access"}
          </Button>
        </>
      }
    >
      <form id="add-staff-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex gap-2">
          <Button variant={mode === "new" ? "primary" : "ghost"} onClick={() => setMode("new")}>
            New account
          </Button>
          <Button variant={mode === "existing" ? "primary" : "ghost"} onClick={() => setMode("existing")}>
            Existing account
          </Button>
        </div>
        {mode === "existing" && (
          <TextField
            label="Firebase Auth UID"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            hint="For someone who already has a sign-in (Firebase console → Authentication) but no role yet."
            required
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
          <TextField label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField label="Job title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          <SelectField
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            options={roleOptions}
          />
          <SelectField
            label="Department"
            value={deptForRole(role, department)}
            disabled={deptIsFixed(role)}
            onChange={(e) => setDepartment(e.target.value as Department)}
            options={deptOptions}
            hint={deptIsFixed(role) ? "Set by the role." : undefined}
          />
        </div>
        {mode === "new" && (
          <div className="space-y-3 rounded-lg border border-slate-800 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Temporary password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                hint="At least 14 characters."
                required
              />
              <TextField
                label="Confirm password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="subtle"
                onClick={() => {
                  const generated = generatePassword();
                  setPassword(generated);
                  setConfirm(generated);
                  setShow(true);
                }}
              >
                Generate strong password
              </Button>
              <Button variant="subtle" onClick={() => setShow((v) => !v)}>
                {show ? "Hide" : "Show"} password
              </Button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

function EditStaffModal({
  row,
  actorUid,
  accessRows,
  onClose,
  onDone,
}: {
  row: StaffRow;
  actorUid: string;
  accessRows: { uid: string; role: Role; active: boolean }[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const self = row.uid === actorUid;
  const [name, setName] = useState(row.profile?.name ?? "");
  const [jobTitle, setJobTitle] = useState(row.profile?.jobTitle ?? "");
  const [email, setEmail] = useState(row.profile?.workEmail ?? "");
  const [role, setRole] = useState<Role>(row.access?.role ?? "employee");
  const [department, setDepartment] = useState<Department>(row.access?.dept ?? "technical");
  const [active, setActive] = useState(row.access?.active ?? true);
  const [phone, setPhone] = useState(row.hr?.phone ?? "");
  const [employmentType, setEmploymentType] = useState(row.hr?.employmentType ?? "");
  const [reportsTo, setReportsTo] = useState(row.hr?.reportsTo ?? "");
  const [startDate, setStartDate] = useState(
    row.hr?.startDate ? row.hr.startDate.toISOString().slice(0, 10) : todayKey(),
  );
  const [emergency, setEmergency] = useState(row.hr?.emergencyContact ?? "");
  const [notes, setNotes] = useState(row.hr?.hrNotes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const profileProblem = validateProfileInput({ name, jobTitle, workEmail: email });
    if (profileProblem) return setError(profileProblem);
    const hrProblem = validateHrInput({
      phone,
      employmentType,
      reportsTo,
      startDate,
      emergencyContact: emergency,
      hrNotes: notes,
      selfUid: row.uid,
    });
    if (hrProblem) return setError(hrProblem);
    if (!self) {
      const problem = validateAccessChange(accessRows, { uid: row.uid, role, active }, actorUid);
      if (problem) return setError(problem);
    }
    setBusy(true);
    try {
      await saveStaff({
        uid: row.uid,
        actorUid,
        profile: { name, jobTitle, workEmail: email },
        access: self ? undefined : { role, department, active },
        existing: { access: row.access, profile: row.profile },
        fallbackDepartment: department,
        hr: {
          details: { phone, employmentType, reportsTo, startDate, emergencyContact: emergency, hrNotes: notes },
          exists: Boolean(row.hr),
        },
      });
      await onDone();
    } catch (err) {
      setError(errorText(err, "Could not save. Nothing was changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Edit ${row.profile?.name || "staff member"}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="edit-staff-form" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        </>
      }
    >
      <form id="edit-staff-form" onSubmit={submit} className="space-y-6">
        {error && <ErrorNote>{error}</ErrorNote>}
        {!row.profile && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            This account has no directory profile yet. Saving creates one.
          </p>
        )}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-white">Profile</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
            <TextField label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required hint="Directory email. The sign-in email is changed in Firebase console." />
            <TextField label="Job title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </div>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold text-white">Access</h3>
          {self ? (
            <p className="text-sm text-slate-400">You cannot change your own role. Ask another admin.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} options={roleOptions} />
              <SelectField
                label="Department"
                value={deptForRole(role, department)}
                disabled={deptIsFixed(role)}
                onChange={(e) => setDepartment(e.target.value as Department)}
                options={deptOptions}
              />
              <SelectField
                label="Status"
                value={active ? "active" : "inactive"}
                onChange={(e) => setActive(e.target.value === "active")}
                options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive (no access)" }]}
              />
            </div>
          )}
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold text-white">HR details <span className="font-normal text-slate-500">(visible to admins and the person)</span></h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <TextField label="Employment type" value={employmentType} placeholder="Full-time, Intern…" onChange={(e) => setEmploymentType(e.target.value)} />
            <TextField label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            <EntityPicker
              label="Reports to (leave approver)"
              staff
              value={reportsTo}
              onChange={(id) => setReportsTo(id)}
              hint="Needed before this person can request leave."
            />
          </div>
          <div className="mt-4 grid gap-4">
            <TextField label="Emergency contact" value={emergency} onChange={(e) => setEmergency(e.target.value)} />
            <TextAreaField label="HR notes" value={notes} rows={3} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default AdminPage;
