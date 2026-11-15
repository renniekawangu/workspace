import { todayKey } from "../../lib/format";
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
import { loadUsers, type Profile } from "../../lib/data";
import { db } from "../../lib/firebase";
import { canManageProjects } from "../../lib/roles";
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
  type EntityOption,
  type Tone,
} from "../../lib/ui";

type Milestone = {
  id: string;
  title: string;
  dueDate: string;
  done: boolean;
};

type Project = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  description: string;
  status: "planning" | "active" | "on_hold" | "completed";
  priority: "low" | "medium" | "high" | "urgent";
  startDate: string;
  dueDate: string;
  managerId: string;
  memberIds: string[];
  milestones: Milestone[];
  updatedAt?: { seconds: number };
};

type ClientOption = { id: string; company: string };

type CreateForm = {
  name: string;
  clientId: string;
  description: string;
  status: Project["status"];
  priority: Project["priority"];
  startDate: string;
  dueDate: string;
  managerId: string;
  memberIds: string[];
};

const blankForm = (): CreateForm => ({
  name: "",
  clientId: "",
  description: "",
  status: "planning",
  priority: "medium",
  startDate: todayKey(),
  dueDate: "",
  managerId: "",
  memberIds: [],
});

const statusOptions = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
];

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

function statusTone(status: Project["status"]): Tone {
  if (status === "completed") return "green";
  if (status === "active") return "blue";
  if (status === "on_hold") return "amber";
  return "slate";
}

function priorityTone(priority: Project["priority"]): Tone {
  if (priority === "urgent") return "red";
  if (priority === "high") return "amber";
  if (priority === "medium") return "blue";
  return "slate";
}

export function ProjectsPage() {
  const { user, role } = useAuth();
  const toast = useToast();
  const canManage = canManageProjects(role);

  const [items, setItems] = useState<Project[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [staffById, setStaffById] = useState<Record<string, Profile>>({});
  const [form, setForm] = useState<CreateForm>(blankForm);
  const [memberToAdd, setMemberToAdd] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState("");
  const [milestoneDraft, setMilestoneDraft] = useState("");
  const [milestoneDate, setMilestoneDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user || !role) return;
    setLoading(true);
    setError("");
    try {
      const constraints = canManage
        ? [orderBy("updatedAt", "desc"), limit(150)]
        : [where("memberIds", "array-contains", user.uid)];
      const snap = await getDocs(
        query(collection(db, "projects"), ...constraints),
      );
      const rows = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<Project, "id">) }),
      );
      rows.sort((a, b) => {
        const aUpdated = a.updatedAt ? new Date(a.updatedAt.seconds * 1000).getTime() : 0;
        const bUpdated = b.updatedAt ? new Date(b.updatedAt.seconds * 1000).getTime() : 0;
        return bUpdated - aUpdated;
      });
      setItems(rows);
    } catch {
      setError(
        "Projects could not be loaded. Check your connection and project access permissions.",
      );
    } finally {
      setLoading(false);
    }
  }, [user, role, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canManage) return;
    getDocs(query(collection(db, "clients"), orderBy("company"), limit(200)))
      .then((snap) =>
        setClients(
          snap.docs.map((d) => ({
            id: d.id,
            company: String(d.data().company ?? ""),
          })),
        ),
      )
      .catch(() => setClients([]));
  }, [canManage]);

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

  const clientOptions: EntityOption[] = useMemo(
    () =>
      clients
        .map((c) => ({ id: c.id, label: c.company || c.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [clients],
  );

  const filtered = useMemo(
    () =>
      items.filter(
        (p) =>
          (statusFilter === "all" || p.status === statusFilter) &&
          `${p.name} ${p.clientName} ${p.description}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [items, statusFilter, search],
  );

  const summary = useMemo(() => {
    const today = todayKey();
    return {
      total: items.length,
      active: items.filter((p) => p.status === "active").length,
      overdue: items.filter(
        (p) => p.dueDate < today && p.status !== "completed",
      ).length,
      completed: items.filter((p) => p.status === "completed").length,
    };
  }, [items]);

  async function updateProject(
    project: Project,
    patch: Partial<Pick<Project, "status" | "priority" | "milestones">>,
    action: string,
  ) {
    if (!user || !canManage || busy) return;
    setBusy(true);
    setError("");
    try {
      await updateDoc(doc(db, "projects", project.id), {
        ...patch,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      await writeAudit(user.uid, action, "project", project.id);
      await load();
    } catch {
      setError(
        "The project update was rejected. Check your permissions and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (
      !user ||
      !canManage ||
      !form.name.trim() ||
      !form.dueDate ||
      form.dueDate < form.startDate
    ) {
      setError("Name, start date and a due date on or after the start date are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const client = clients.find((c) => c.id === form.clientId);
      const managerId = form.managerId.trim() || user.uid;
      const memberIds = [
        ...new Set(
          [user.uid, managerId, ...form.memberIds].filter(Boolean),
        ),
      ];
      if (editingId) {
        const editMembers = [...new Set([managerId, ...form.memberIds].filter(Boolean))];
        await updateDoc(doc(db, "projects", editingId), {
          name: form.name.trim(),
          clientId: form.clientId,
          clientName: client?.company ?? "Internal project",
          description: form.description.trim(),
          status: form.status,
          priority: form.priority,
          startDate: form.startDate,
          dueDate: form.dueDate,
          managerId,
          memberIds: editMembers,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });
        await writeAudit(user.uid, "project.updated", "project", editingId);
        setEditingId(null);
        setForm(blankForm());
        setMemberToAdd("");
        setCreateOpen(false);
        await load();
        toast("Project updated.", "success");
        return;
      }
      const ref = await addDoc(collection(db, "projects"), {
        name: form.name.trim(),
        clientId: form.clientId,
        clientName: client?.company ?? "Internal project",
        description: form.description.trim(),
        status: form.status,
        priority: form.priority,
        startDate: form.startDate,
        dueDate: form.dueDate,
        managerId,
        memberIds,
        milestones: [],
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      await writeAudit(user.uid, "project.created", "project", ref.id);
      setForm(blankForm());
      setMemberToAdd("");
      setCreateOpen(false);
      await load();
      toast("Project created and team access saved.", "success");
    } catch {
      setError(
        "Project could not be created. Confirm your role and Firestore rules are updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addMilestone(project: Project) {
    const title = milestoneDraft.trim();
    if (!title || !canManage) return;
    const next = [
      ...(project.milestones ?? []),
      {
        id: `${Date.now()}`,
        title,
        dueDate: milestoneDate,
        done: false,
      },
    ];
    await updateProject(project, { milestones: next }, "project.milestone_added");
    setMilestoneDraft("");
    setMilestoneDate("");
  }

  async function toggleMilestone(project: Project, milestoneId: string) {
    if (!canManage) return;
    const next = (project.milestones ?? []).map((m) =>
      m.id === milestoneId ? { ...m, done: !m.done } : m,
    );
    await updateProject(
      project,
      { milestones: next },
      "project.milestone_updated",
    );
  }

  function addMember(id: string) {
    if (!id) return;
    setForm((current) =>
      current.memberIds.includes(id)
        ? current
        : { ...current, memberIds: [...current.memberIds, id] },
    );
    setMemberToAdd("");
  }

  function removeMember(id: string) {
    setForm((current) => ({
      ...current,
      memberIds: current.memberIds.filter((memberId) => memberId !== id),
    }));
  }

  return (
    <section className="space-y-7">
      <PageHeader
        eyebrow="Delivery operations"
        title="Projects"
        description="Plan client work, coordinate delivery teams, track milestones and spot projects that need attention."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => void load()} disabled={loading}>
              Refresh
            </Button>
            {canManage && (
              <Button
                onClick={() => {
                  setForm(blankForm());
                  setEditingId(null);
                  setMemberToAdd("");
                  setCreateOpen(true);
                }}
              >
                New project
              </Button>
            )}
          </div>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="metric-card">
          <p className="text-xs text-slate-500">Projects</p>
          <p className="mt-2 text-2xl font-semibold text-white">
            {summary.total}
          </p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-slate-500">Active</p>
          <p className="mt-2 text-2xl font-semibold text-sky-300">
            {summary.active}
          </p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-slate-500">Overdue</p>
          <p className="mt-2 text-2xl font-semibold text-amber-200">
            {summary.overdue}
          </p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-slate-500">Completed</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-300">
            {summary.completed}
          </p>
        </div>
      </div>

      <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <TextField
            label="Search"
            placeholder="Name, client or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="sm:w-48">
          <SelectField
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: "all", label: "All statuses" },
              ...statusOptions,
            ]}
          />
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading projects…" rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No projects found"
          text={
            canManage
              ? "Create your first project to start organising delivery."
              : "Projects you are assigned to will appear here."
          }
          action={
            canManage ? (
              <Button
                onClick={() => {
                  setForm(blankForm());
                  setCreateOpen(true);
                }}
              >
                New project
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((project) => {
            const milestones = project.milestones ?? [];
            const done = milestones.filter((m) => m.done).length;
            const progress = milestones.length
              ? Math.round((done / milestones.length) * 100)
              : project.status === "completed"
                ? 100
                : 0;
            const overdue =
              project.dueDate < todayKey() &&
              project.status !== "completed";

            return (
              <article key={project.id} className="panel flex flex-col p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-400">
                      {project.clientName || "Internal project"}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-white">
                      {project.name}
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone={priorityTone(project.priority)}>
                      {project.priority}
                    </StatusPill>
                    <StatusPill tone={statusTone(project.status)}>
                      {statusOptions.find((s) => s.value === project.status)
                        ?.label ?? project.status}
                    </StatusPill>
                    {overdue && <StatusPill tone="red">Overdue</StatusPill>}
                    {canManage && (
                      <button
                        type="button"
                        className="rounded-full border border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300 hover:border-sky-400 hover:text-white"
                        onClick={() => {
                          setForm({
                            name: project.name,
                            clientId: project.clientId,
                            description: project.description,
                            status: project.status,
                            priority: project.priority,
                            startDate: project.startDate,
                            dueDate: project.dueDate,
                            managerId: project.managerId,
                            memberIds: project.memberIds ?? [],
                          });
                          setEditingId(project.id);
                          setMemberToAdd("");
                          setCreateOpen(true);
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>

                <p className="mt-3 min-h-10 text-sm leading-6 text-slate-400">
                  {project.description || "No project brief provided."}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-slate-500">Start</p>
                    <p className="mt-1 text-slate-200">
                      {project.startDate || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Due</p>
                    <p className="mt-1 text-slate-200">
                      {project.dueDate || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Manager</p>
                    <p className="mt-1 truncate text-slate-200">
                      {project.managerId ? staffName(project.managerId) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Team</p>
                    <p className="mt-1 text-slate-200">
                      {(project.memberIds ?? []).length} member
                      {(project.memberIds ?? []).length === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Milestone progress</span>
                    <span className="font-semibold text-slate-200">
                      {progress}%
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-sky-400 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] text-slate-500">
                    {done} of {milestones.length} milestones completed
                  </p>
                </div>

                {canManage && (
                  <div className="mt-4 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-2">
                    <SelectField
                      label="Status"
                      value={project.status}
                      disabled={busy}
                      onChange={(e) =>
                        void updateProject(
                          project,
                          { status: e.target.value as Project["status"] },
                          "project.status_updated",
                        )
                      }
                      options={statusOptions}
                    />
                    <SelectField
                      label="Priority"
                      value={project.priority}
                      disabled={busy}
                      onChange={(e) =>
                        void updateProject(
                          project,
                          {
                            priority: e.target.value as Project["priority"],
                          },
                          "project.priority_updated",
                        )
                      }
                      options={priorityOptions}
                    />
                  </div>
                )}

                <div className="mt-4 border-t border-slate-800 pt-3">
                  <button
                    type="button"
                    className="text-xs font-semibold text-sky-300 hover:text-white"
                    onClick={() =>
                      setExpanded(expanded === project.id ? "" : project.id)
                    }
                  >
                    {expanded === project.id
                      ? "Hide milestones ↑"
                      : "View milestones ↓"}
                  </button>

                  {expanded === project.id && (
                    <div className="mt-3 space-y-2">
                      {milestones.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center gap-2 rounded-lg bg-slate-900/70 px-3 py-2"
                        >
                          <input
                            type="checkbox"
                            aria-label={`Complete ${m.title}`}
                            checked={m.done}
                            disabled={!canManage || busy}
                            onChange={() =>
                              void toggleMilestone(project, m.id)
                            }
                            className="h-4 w-4 accent-sky-400"
                          />
                          <span
                            className={`flex-1 text-xs ${
                              m.done
                                ? "text-slate-500 line-through"
                                : "text-slate-200"
                            }`}
                          >
                            {m.title}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {m.dueDate || "No date"}
                          </span>
                        </div>
                      ))}

                      {milestones.length === 0 && (
                        <p className="text-xs text-slate-500">
                          No milestones have been added yet.
                        </p>
                      )}

                      {canManage && expanded === project.id && (
                        <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                          <input
                            aria-label="New milestone title"
                            placeholder="Add a milestone…"
                            maxLength={180}
                            className="min-h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-white"
                            value={milestoneDraft}
                            onChange={(e) => setMilestoneDraft(e.target.value)}
                          />
                          <input
                            aria-label="Milestone due date"
                            type="date"
                            className="min-h-11 rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-white"
                            value={milestoneDate}
                            onChange={(e) => setMilestoneDate(e.target.value)}
                          />
                          <Button
                            variant="subtle"
                            className="min-h-11 px-3 text-xs"
                            disabled={!milestoneDraft.trim() || busy}
                            onClick={() => void addMilestone(project)}
                          >
                            Add
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {createOpen && canManage && (
        <Modal
          title={editingId ? "Edit project" : "New project"}
          size="lg"
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
              <Button
                type="submit"
                form="project-create-form"
                disabled={busy}
              >
                {busy ? "Saving…" : editingId ? "Save changes" : "Create project"}
              </Button>
            </>
          }
        >
          <form
            id="project-create-form"
            onSubmit={createProject}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <TextField
                label="Project name"
                required
                maxLength={160}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="sm:col-span-2">
              <EntityPicker
                label="Client (optional)"
                value={form.clientId}
                onChange={(id) => setForm({ ...form, clientId: id })}
                options={clientOptions}
                placeholder="Internal project or pick a client…"
                allowClear
              />
            </div>

            <SelectField
              label="Status"
              value={form.status}
              onChange={(e) =>
                setForm({
                  ...form,
                  status: e.target.value as Project["status"],
                })
              }
              options={statusOptions}
            />
            <SelectField
              label="Priority"
              value={form.priority}
              onChange={(e) =>
                setForm({
                  ...form,
                  priority: e.target.value as Project["priority"],
                })
              }
              options={priorityOptions}
            />

            <TextField
              label="Start date"
              required
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
            <TextField
              label="Due date"
              required
              type="date"
              min={form.startDate}
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />

            <div className="sm:col-span-2">
              <EntityPicker
                label="Project manager"
                staff
                value={form.managerId}
                onChange={(id) => setForm({ ...form, managerId: id })}
                placeholder="Select manager…"
                hint="Defaults to you if left empty."
              />
            </div>

            <div className="sm:col-span-2 space-y-3">
              <EntityPicker
                label="Add team member"
                staff
                value={memberToAdd}
                onChange={(id) => addMember(id)}
                placeholder="Search staff to add…"
                allowClear={false}
              />
              {form.memberIds.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {form.memberIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => removeMember(id)}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:border-red-400/50 hover:text-red-200"
                      title="Remove from team"
                    >
                      <Avatar name={staffName(id)} size={20} />
                      <span className="max-w-[10rem] truncate">{staffName(id)}</span>
                      <span aria-hidden>×</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500">
                You and the manager are always included in project access.
              </p>
            </div>

            <div className="sm:col-span-2">
              <TextAreaField
                label="Brief / description"
                rows={4}
                maxLength={4000}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
