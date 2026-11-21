import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../../app/AuthProvider";
import { writeAudit } from "../../lib/audit";
import { notify } from "../../lib/notify";
import { loadTasks, loadUsers, type Profile } from "../../lib/data";
import {
  DEPARTMENTS,
  PRIORITIES,
  TASK_STATUSES,
  type Department,
  type Priority,
  type Role,
} from "../../lib/enums";
import { db } from "../../lib/firebase";
import {
  canCreateTasks,
  getRoleDepartment,
} from "../../lib/roles";
import { useToast } from "../../lib/toast";
import {
  Avatar,
  Button,
  EmptyState,
  EntityPicker,
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

type Task = {
  id: string;
  title: string;
  description: string;
  department: string;
  status: "todo" | "in_progress" | "done";
  assigneeId: string;
  priority?: Priority;
  dueDate?: Date | string | { toDate?: () => Date } | null;
};

type Filter = "all" | Task["status"];

type CreateForm = {
  title: string;
  description: string;
  department: Department;
  assigneeId: string;
  status: Task["status"];
  priority: Priority;
  dueDate: string;
};

const departmentLabels: Record<Department, string> = {
  technical: "Technical",
  business: "Business",
  digital: "Digital",
  creative: "Creative",
};

const statusLabel: Record<Task["status"], string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

const priorityLabel: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const priorityClasses: Record<Priority, string> = {
  low: "border-slate-600 bg-slate-800 text-slate-200",
  medium: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  high: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  urgent: "border-red-500/40 bg-red-500/10 text-red-200",
};

function statusTone(status: Task["status"]): Tone {
  if (status === "done") return "green";
  if (status === "in_progress") return "blue";
  return "amber";
}

function formatDueDate(value: Task["dueDate"]): string {
  if (!value) return "No due date";
  if (typeof value === "string") return new Date(value).toLocaleDateString();
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value.toDate === "function") {
    return value.toDate().toLocaleDateString();
  }
  return "No due date";
}

function blankForm(role: Role | null): CreateForm {
  const department = getRoleDepartment(role) ?? "technical";
  return {
    title: "",
    description: "",
    department,
    assigneeId: "",
    status: "todo",
    priority: "medium",
    dueDate: "",
  };
}

export function TaskBoardPage() {
  const { user, role } = useAuth();
  const toast = useToast();
  const canCreate = canCreateTasks(role);

  const [items, setItems] = useState<Task[]>([]);
  const [staffById, setStaffById] = useState<Record<string, Profile>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<CreateForm>(blankForm(role));

  const load = useCallback(async () => {
    if (!user || !role) return;
    setLoading(true);
    setError("");
    try {
      setItems(await loadTasks({ uid: user.uid, role }, true));
    } catch {
      setError(
        "We couldn't load tasks available to your account. Please refresh or contact an administrator if this continues.",
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

  useEffect(() => {
    setForm(blankForm(role));
  }, [role]);

  const staffName = (id: string) =>
    staffById[id]?.name || staffById[id]?.workEmail || id || "Unassigned";

  const departmentOptions = useMemo(() => {
    if (role === "admin") {
      return DEPARTMENTS.map((value) => ({
        value,
        label: departmentLabels[value],
      }));
    }
    const locked = getRoleDepartment(role) ?? "technical";
    return [{ value: locked, label: departmentLabels[locked] }];
  }, [role]);

  async function changeStatus(item: Task, status: Task["status"]) {
    if (!user || status === item.status || updatingId) return;
    setUpdatingId(item.id);
    setError("");
    try {
      await updateDoc(doc(db, "tasks", item.id), {
        status,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      await writeAudit(user.uid, "task.status_updated", "task", item.id);
      setItems((current) =>
        current.map((task) =>
          task.id === item.id ? { ...task, status } : task,
        ),
      );
      toast(`Marked as ${statusLabel[status].toLowerCase()}.`, "success");
    } catch {
      setError(
        "That task could not be updated. Your role may not have permission to change it.",
      );
    } finally {
      setUpdatingId("");
    }
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (!user || !canCreate || !form.title.trim()) return;
    if (role !== "admin") {
      const allowed = getRoleDepartment(role);
      if (allowed && form.department !== allowed) {
        setError("You can only create tasks in your department.");
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      const ref = await addDoc(collection(db, "tasks"), {
        title: form.title.trim(),
        description: form.description.trim(),
        department: form.department,
        assigneeId: form.assigneeId || user.uid,
        status: form.status,
        priority: form.priority,
        dueDate: form.dueDate ? new Date(form.dueDate) : null,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      await writeAudit(user.uid, "task.created", "task", ref.id);
      void notify("task.created", ref.id);
      setForm(blankForm(role));
      setCreateOpen(false);
      await load();
      toast("Task created.", "success");
    } catch {
      setError(
        "Task could not be created. Check your role, department and required fields.",
      );
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const base = { all: items.length, todo: 0, in_progress: 0, done: 0 };
    for (const item of items) base[item.status] += 1;
    return base;
  }, [items]);

  const visibleItems = useMemo(
    () =>
      filter === "all" ? items : items.filter((item) => item.status === filter),
    [items, filter],
  );

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "todo", label: "To do" },
    { id: "in_progress", label: "In progress" },
    { id: "done", label: "Done" },
  ];

  return (
    <section className="space-y-7">
      <PageHeader
        eyebrow="Work management"
        title="Tasks"
        description="Track work assigned to you or visible in your department. Update progress as you go."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => void load()} disabled={loading}>
              Refresh
            </Button>
            {canCreate && (
              <Button
                onClick={() => {
                  setForm(blankForm(role));
                  setCreateOpen(true);
                }}
              >
                New task
              </Button>
            )}
          </div>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="metric-card">
          <p className="text-xs text-slate-500">Visible tasks</p>
          <p className="mt-2 text-2xl font-semibold text-white">{counts.all}</p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-slate-500">To do</p>
          <p className="mt-2 text-2xl font-semibold text-amber-200">
            {counts.todo}
          </p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-slate-500">In progress</p>
          <p className="mt-2 text-2xl font-semibold text-sky-300">
            {counts.in_progress}
          </p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-slate-500">Done</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-300">
            {counts.done}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((chip) => {
          const active = filter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition ${
                active
                  ? "border-sky-400/40 bg-sky-400/10 text-sky-200"
                  : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
              }`}
            >
              {chip.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  active
                    ? "bg-sky-400/20 text-sky-100"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {counts[chip.id]}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <LoadingState label="Loading tasks…" rows={4} />
      ) : visibleItems.length === 0 ? (
        <EmptyState
          title={
            filter === "all" ? "No tasks available" : "Nothing in this status"
          }
          text={
            filter === "all"
              ? "Tasks assigned to you or visible to your department will appear here."
              : "Try another status filter to see more of your work."
          }
          action={
            filter !== "all" ? (
              <Button variant="ghost" onClick={() => setFilter("all")}>
                Show all tasks
              </Button>
            ) : canCreate ? (
              <Button
                onClick={() => {
                  setForm(blankForm(role));
                  setCreateOpen(true);
                }}
              >
                New task
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {visibleItems.map((item) => (
            <article key={item.id} className="panel flex flex-col p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  {item.department || "General"}
                </span>
                <StatusPill tone={statusTone(item.status)}>
                  {statusLabel[item.status]}
                </StatusPill>
              </div>

              <h3 className="mt-5 text-base font-semibold text-white">
                {item.title}
              </h3>
              <p className="mt-2 min-h-12 text-sm leading-6 text-slate-400">
                {item.description || "No additional details provided."}
              </p>

              <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                <Avatar name={staffName(item.assigneeId)} size={24} />
                <span className="truncate">{staffName(item.assigneeId)}</span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <span
                  className={`rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-wide ${
                    item.priority
                      ? priorityClasses[item.priority]
                      : "border-slate-700 bg-slate-900 text-slate-300"
                  }`}
                >
                  {item.priority ? priorityLabel[item.priority] : "No priority"}
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-300">
                  {formatDueDate(item.dueDate)}
                </span>
              </div>

              <div className="mt-auto border-t border-slate-800 pt-4">
                <p className="mb-2 text-xs font-medium text-slate-400">
                  Update progress
                </p>
                <div className="flex flex-wrap gap-2">
                  {TASK_STATUSES.map((status) => {
                    const active = item.status === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        disabled={updatingId === item.id}
                        onClick={() => void changeStatus(item, status)}
                        className={`inline-flex min-h-10 items-center rounded-lg border px-3 text-xs font-semibold transition disabled:opacity-50 ${
                          active
                            ? status === "done"
                              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                              : status === "in_progress"
                                ? "border-sky-400/40 bg-sky-400/10 text-sky-200"
                                : "border-amber-400/40 bg-amber-400/10 text-amber-200"
                            : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
                        }`}
                      >
                        {statusLabel[status]}
                      </button>
                    );
                  })}
                </div>
                {updatingId === item.id && (
                  <p className="mt-2 text-[11px] text-sky-300">Saving update…</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {createOpen && canCreate && (
        <Modal
          title="New task"
          onClose={() => !busy && setCreateOpen(false)}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" form="task-create-form" disabled={busy}>
                {busy ? "Creating…" : "Create task"}
              </Button>
            </>
          }
        >
          <form
            id="task-create-form"
            onSubmit={createTask}
            className="grid gap-4"
          >
            <TextField
              label="Title"
              required
              maxLength={200}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <TextAreaField
              label="Description"
              rows={4}
              maxLength={4000}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
            <SelectField
              label="Department"
              value={form.department}
              onChange={(e) =>
                setForm({
                  ...form,
                  department: e.target.value as Department,
                })
              }
              options={departmentOptions}
              hint={
                role === "admin"
                  ? undefined
                  : "Locked to your department by access rules."
              }
            />
            <EntityPicker
              label="Assignee"
              staff
              value={form.assigneeId}
              onChange={(id) => setForm({ ...form, assigneeId: id })}
              placeholder="Assign to staff (defaults to you)"
              hint="Leave empty to assign to yourself."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Initial status"
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value as Task["status"],
                  })
                }
                options={TASK_STATUSES.map((value) => ({
                  value,
                  label: statusLabel[value],
                }))}
              />
              <SelectField
                label="Priority"
                value={form.priority}
                onChange={(e) =>
                  setForm({
                    ...form,
                    priority: e.target.value as Priority,
                  })
                }
                options={PRIORITIES.map((value) => ({
                  value,
                  label: priorityLabel[value],
                }))}
              />
            </div>
            <TextField
              label="Due date"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </form>
        </Modal>
      )}
    </section>
  );
}
