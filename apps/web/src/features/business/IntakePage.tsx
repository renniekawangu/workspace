import { useEffect, useMemo, useState, type FormEvent } from "react";
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
} from "firebase/firestore";
import { useAuth } from "../../app/AuthProvider";
import { writeAudit } from "../../lib/audit";
import { notify } from "../../lib/notify";
import { db } from "../../lib/firebase";
import { canManageBusiness } from "../../lib/roles";
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
import {
  INTAKE_STATUSES,
  LIMITS,
  PAGE_OPTIONS,
  PHOTO_OPTIONS,
  STYLE_OPTIONS,
  blankIntake,
  buildBrief,
  buildSummary,
  cleanIntake,
  parseSummary,
  validateIntake,
  type IntakeData,
  type IntakeStatus,
} from "./intake";
import { clientFields, leadFields, projectFields } from "./intakeLinks";

type Intake = IntakeData & {
  id: string;
  status: IntakeStatus;
  source: "staff" | "client_summary" | "client_form";
  leadId?: string;
  clientId?: string;
  projectId?: string;
};

const statusLabel: Record<IntakeStatus, string> = {
  new: "New",
  in_review: "In review",
  building: "Building",
  delivered: "Delivered",
  archived: "Archived",
};
const statusTone = (s: IntakeStatus): Tone =>
  s === "delivered"
    ? "green"
    : s === "building"
      ? "blue"
      : s === "in_review"
        ? "amber"
        : "slate";

/** Firestore may omit fields on older/partial docs; fill from blank so the UI never crashes. */
const normalise = (id: string, raw: Partial<Intake>): Intake => ({
  ...blankIntake(),
  ...raw,
  id,
  status: raw.status ?? "new",
  source: raw.source ?? "staff",
});

function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="block text-sm font-medium text-slate-300">
        {label}
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-slate-700 px-3 text-sm text-slate-200 has-[:checked]:border-sky-400 has-[:checked]:text-white"
          >
            <input
              type="checkbox"
              checked={value.includes(o)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, o]
                    : value.filter((x) => x !== o),
                )
              }
            />
            {o}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function IntakePage() {
  const { user, role } = useAuth();
  const toast = useToast();
  const canManage = canManageBusiness(role);
  const [items, setItems] = useState<Intake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | IntakeStatus>("all");
  const [form, setForm] = useState<IntakeData>(blankIntake);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [source, setSource] = useState<Intake["source"]>("staff");
  const [linking, setLinking] = useState("");
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [importError, setImportError] = useState("");
  const [viewing, setViewing] = useState<Intake | null>(null);

  async function load() {
    const snap = await getDocs(
      query(
        collection(db, "intakes"),
        orderBy("updatedAt", "desc"),
        limit(150),
      ),
    );
    setItems(
      snap.docs.map((d) => normalise(d.id, d.data() as Partial<Intake>)),
    );
  }
  useEffect(() => {
    setLoading(true);
    void load()
      .catch(() =>
        setError("Could not load intakes. Check your access and connection."),
      )
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () =>
      items.filter(
        (x) =>
          (statusFilter === "all" || x.status === statusFilter) &&
          `${x.businessName} ${x.location} ${x.email} ${x.whatsapp}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [items, search, statusFilter],
  );

  const set = <K extends keyof IntakeData>(k: K, v: IntakeData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const openNew = (data = blankIntake(), src: Intake["source"] = "staff") => {
    setForm(data);
    setEditingId(null);
    setSource(src);
    setErrors({});
    setFormOpen(true);
  };
  const openEdit = (it: Intake) => {
    const data = Object.fromEntries(
      Object.keys(blankIntake()).map((k) => [k, it[k as keyof IntakeData]]),
    ) as IntakeData;
    setForm(data);
    setEditingId(it.id);
    setSource(it.source);
    setErrors({});
    setFormOpen(true);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user || !canManage) return;
    const data = cleanIntake(form);
    const found = validateIntake(data);
    setErrors(found);
    if (Object.keys(found).length) {
      setError("Fix the highlighted fields.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (editingId) {
        await updateDoc(doc(db, "intakes", editingId), {
          ...data,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });
        await writeAudit(user.uid, "intake.updated", "intake", editingId);
        toast("Intake updated.", "success");
      } else {
        const ref = await addDoc(collection(db, "intakes"), {
          ...data,
          status: "new" as IntakeStatus,
          source,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });
        await writeAudit(user.uid, "intake.created", "intake", ref.id);
        toast("Intake saved.", "success");
      }
      setFormOpen(false);
      await load();
    } catch {
      setError(
        "Intake could not be saved. Check your role and the field lengths.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(it: Intake, status: IntakeStatus) {
    if (!user || status === it.status) return;
    try {
      await updateDoc(doc(db, "intakes", it.id), {
        status,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      await writeAudit(user.uid, "intake.status_changed", "intake", it.id);
      await load();
      toast(`Status set to ${statusLabel[status]}.`, "success");
    } catch {
      setError("Status update failed. Check your permissions.");
    }
  }

  function runImport() {
    const parsed = parseSummary(pasted);
    if (!parsed) {
      setImportError(
        "That doesn't look like a summary from the client form. Paste the full text.",
      );
      return;
    }
    setImportOpen(false);
    setPasted("");
    setImportError("");
    openNew(parsed, "client_summary");
  }

  /** Creates the linked record, then stores its id on the intake. Re-entry is blocked while one is running. */
  async function convert(it: Intake, kind: "lead" | "client" | "project") {
    if (!user || !canManage || linking) return;
    setLinking(`${it.id}:${kind}`);
    setError("");
    const stamps = () => ({
      createdAt: serverTimestamp(),
      createdBy: user.uid,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    });
    try {
      let patch: Record<string, string> = {};
      if (kind === "lead") {
        const ref = await addDoc(collection(db, "leads"), {
          ...leadFields(it),
          stage: "New",
          ...stamps(),
        });
        await writeAudit(user.uid, "lead.created", "lead", ref.id);
        void notify("lead.created", ref.id);
        patch = {
          leadId: ref.id,
          ...(it.status === "new" ? { status: "in_review" } : {}),
        };
      } else if (kind === "client") {
        const ref = await addDoc(collection(db, "clients"), {
          ...clientFields(it),
          ...stamps(),
        });
        await writeAudit(user.uid, "client.created", "client", ref.id);
        patch = { clientId: ref.id };
        if (it.leadId) {
          try {
            await updateDoc(doc(db, "leads", it.leadId), {
              stage: "Won",
              updatedAt: serverTimestamp(),
              updatedBy: user.uid,
            });
            await writeAudit(user.uid, "lead.stage_changed", "lead", it.leadId);
          } catch {
            /* the client exists either way; the lead can be moved by hand */
          }
        }
      } else {
        if (!it.clientId) return;
        const today = new Date().toLocaleDateString("en-CA");
        const ref = await addDoc(collection(db, "projects"), {
          ...projectFields(it, it.clientId, user.uid, today),
          ...stamps(),
        });
        await writeAudit(user.uid, "project.created", "project", ref.id);
        patch = { projectId: ref.id, status: "building" };
      }
      await updateDoc(doc(db, "intakes", it.id), {
        ...patch,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      await writeAudit(user.uid, "intake.updated", "intake", it.id);
      await load();
      toast(
        kind === "lead"
          ? "Added to leads."
          : kind === "client"
            ? "Client created."
            : "Project created.",
        "success",
      );
    } catch {
      setError(
        "Could not create that record. Check your role and try again. If it keeps failing, make sure the latest Firestore rules are deployed.",
      );
    } finally {
      setLinking("");
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied.", "success");
    } catch {
      toast("Copy failed. Select the text and copy manually.", "error");
    }
  }
  function download(it: Intake) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([buildSummary(it)], { type: "text/plain" }),
    );
    a.download = `${(it.businessName || "company").replace(/\W+/g, "-").toLowerCase()}-website-details.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="Business development"
        title="Website intake"
        description="Collect what we need to build a client's website. Fill it in on a call, or paste the summary the client sent."
        actions={
          canManage && (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setPasted("");
                  setImportError("");
                  setImportOpen(true);
                }}
              >
                Paste client summary
              </Button>
              <Button onClick={() => openNew()}>New intake</Button>
            </>
          )
        }
      />
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {(["all", ...INTAKE_STATUSES] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`metric-card text-left ${statusFilter === s ? "ring-1 ring-sky-400/30" : ""}`}
          >
            <p className="text-xs text-slate-500">
              {s === "all" ? "All" : statusLabel[s]}
            </p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {s === "all"
                ? items.length
                : items.filter((x) => x.status === s).length}
            </p>
          </button>
        ))}
      </div>

      <div className="panel p-4">
        <TextField
          label="Search"
          placeholder="Business, location, email or number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <LoadingState label="Loading intakes…" rows={3} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No intakes yet"
          text="Start a new intake or paste a summary a client sent you."
          action={
            canManage ? (
              <Button onClick={() => openNew()}>New intake</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map((it) => (
            <article key={it.id} className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-white">
                    {it.businessName}
                  </h3>
                  <p className="mt-1 text-sm text-slate-400">{it.location}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {it.source === "client_form" && (
                    <StatusPill tone="blue">Client form</StatusPill>
                  )}
                  <StatusPill tone={statusTone(it.status)}>
                    {statusLabel[it.status]}
                  </StatusPill>
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-400">{it.whatTheyDo}</p>
              <div className="mt-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                <p>
                  {it.whatsapp
                    ? `WhatsApp ${it.whatsapp}`
                    : it.phone || "No number"}
                </p>
                <p>{it.email || "No email"}</p>
                <p>
                  {it.products.length} products · {it.services.length} services
                </p>
                <p>Deadline: {it.deadline || "Not set"}</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                <SelectField
                  label="Status"
                  value={it.status}
                  disabled={!canManage}
                  onChange={(e) =>
                    void changeStatus(it, e.target.value as IntakeStatus)
                  }
                  options={INTAKE_STATUSES.map((v) => ({
                    value: v,
                    label: statusLabel[v],
                  }))}
                />
                <Button variant="ghost" onClick={() => setViewing(it)}>
                  Summary
                </Button>
                {canManage && (
                  <Button variant="ghost" onClick={() => openEdit(it)}>
                    Edit
                  </Button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                <Button
                  variant="subtle"
                  onClick={() => void copy(buildBrief(it))}
                >
                  Copy build brief
                </Button>
                {canManage && !it.leadId && !it.clientId && (
                  <Button
                    variant="subtle"
                    disabled={!!linking}
                    onClick={() => void convert(it, "lead")}
                  >
                    {linking === `${it.id}:lead` ? "Adding…" : "Add to leads"}
                  </Button>
                )}
                {canManage && !it.clientId && (
                  <Button
                    variant="subtle"
                    disabled={!!linking}
                    onClick={() => void convert(it, "client")}
                  >
                    {linking === `${it.id}:client`
                      ? "Creating…"
                      : "Make client"}
                  </Button>
                )}
                {canManage && it.clientId && !it.projectId && (
                  <Button
                    variant="subtle"
                    disabled={!!linking}
                    onClick={() => void convert(it, "project")}
                  >
                    {linking === `${it.id}:project`
                      ? "Creating…"
                      : "Start project"}
                  </Button>
                )}
                {(it.leadId || it.clientId || it.projectId) && (
                  <p className="text-xs text-slate-500">
                    Linked:{" "}
                    {[
                      it.leadId && "lead",
                      it.clientId && "client",
                      it.projectId && "project",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {formOpen && (
        <Modal
          size="lg"
          title={editingId ? "Edit intake" : "New intake"}
          onClose={() => !busy && setFormOpen(false)}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" form="intake-form" disabled={busy}>
                {busy ? "Saving…" : "Save intake"}
              </Button>
            </>
          }
        >
          <form
            id="intake-form"
            onSubmit={save}
            noValidate
            className="space-y-8"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <h3 className="text-sm font-semibold text-white sm:col-span-2">
                1. Business basics
              </h3>
              <TextField
                label="Business name *"
                maxLength={LIMITS.businessName}
                value={form.businessName}
                error={errors.businessName}
                onChange={(e) => set("businessName", e.target.value)}
              />
              <TextField
                label="Contact person"
                hint="Who we speak to."
                maxLength={LIMITS.contactName}
                value={form.contactName}
                error={errors.contactName}
                onChange={(e) => set("contactName", e.target.value)}
              />
              <TextField
                label="Tagline"
                maxLength={LIMITS.tagline}
                value={form.tagline}
                error={errors.tagline}
                onChange={(e) => set("tagline", e.target.value)}
              />
              <div className="sm:col-span-2">
                <TextAreaField
                  label="What do they sell or do? *"
                  rows={2}
                  maxLength={LIMITS.whatTheyDo}
                  value={form.whatTheyDo}
                  error={errors.whatTheyDo}
                  onChange={(e) => set("whatTheyDo", e.target.value)}
                />
              </div>
              <TextField
                label="Location (city, country) *"
                maxLength={LIMITS.location}
                value={form.location}
                error={errors.location}
                onChange={(e) => set("location", e.target.value)}
              />
              <TextField
                label="WhatsApp (with country code)"
                type="tel"
                maxLength={LIMITS.whatsapp}
                value={form.whatsapp}
                error={errors.whatsapp}
                onChange={(e) => set("whatsapp", e.target.value)}
              />
              <TextField
                label="Email"
                type="email"
                maxLength={LIMITS.email}
                value={form.email}
                error={errors.email}
                onChange={(e) => set("email", e.target.value)}
              />
              <TextField
                label="Phone (if different)"
                type="tel"
                maxLength={LIMITS.phone}
                value={form.phone}
                error={errors.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
              <div className="sm:col-span-2">
                <TextAreaField
                  label="Social media links"
                  hint="Only real, active ones."
                  rows={2}
                  maxLength={LIMITS.social}
                  value={form.social}
                  error={errors.social}
                  onChange={(e) => set("social", e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-white">2. Pages</h3>
              <Chips
                label="Pages wanted"
                options={PAGE_OPTIONS}
                value={form.pages}
                onChange={(v) => set("pages", v)}
              />
              <TextField
                label="Anything else?"
                hint="Gallery, FAQ, team, other locations."
                maxLength={LIMITS.otherPages}
                value={form.otherPages}
                error={errors.otherPages}
                onChange={(e) => set("otherPages", e.target.value)}
              />
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-white">3. Products</h3>
              <TextField
                label="Categories"
                hint="Separate with commas."
                maxLength={LIMITS.categories}
                value={form.categories}
                error={errors.categories}
                onChange={(e) => set("categories", e.target.value)}
              />
              {errors.products && (
                <p className="text-xs text-red-300" role="alert">
                  {errors.products}
                </p>
              )}
              {form.products.map((p, i) => (
                <div
                  key={i}
                  className="grid gap-3 rounded-lg border border-slate-800 p-3 sm:grid-cols-2"
                >
                  {(
                    ["name", "category", "desc", "price", "photo"] as const
                  ).map((k) => (
                    <TextField
                      key={k}
                      label={
                        {
                          name: "Product name",
                          category: "Category",
                          desc: "Short description",
                          price: "Price (blank = on enquiry)",
                          photo: "Photo file name",
                        }[k]
                      }
                      maxLength={LIMITS.productField}
                      value={p[k]}
                      onChange={(e) =>
                        set(
                          "products",
                          form.products.map((x, j) =>
                            j === i ? { ...x, [k]: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  ))}
                  <div className="flex items-end">
                    <Button
                      variant="danger"
                      onClick={() =>
                        set(
                          "products",
                          form.products.filter((_, j) => j !== i),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                variant="ghost"
                disabled={form.products.length >= LIMITS.products}
                onClick={() =>
                  set("products", [
                    ...form.products,
                    { name: "", category: "", desc: "", price: "", photo: "" },
                  ])
                }
              >
                + Add a product
              </Button>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-white">4. Services</h3>
              {errors.services && (
                <p className="text-xs text-red-300" role="alert">
                  {errors.services}
                </p>
              )}
              {form.services.map((s, i) => (
                <div
                  key={i}
                  className="grid gap-3 rounded-lg border border-slate-800 p-3 sm:grid-cols-2"
                >
                  <TextField
                    label="Service name"
                    maxLength={LIMITS.serviceField}
                    value={s.name}
                    onChange={(e) =>
                      set(
                        "services",
                        form.services.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <TextField
                    label="One-line description"
                    maxLength={LIMITS.serviceField}
                    value={s.desc}
                    onChange={(e) =>
                      set(
                        "services",
                        form.services.map((x, j) =>
                          j === i ? { ...x, desc: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <div>
                    <Button
                      variant="danger"
                      onClick={() =>
                        set(
                          "services",
                          form.services.filter((_, j) => j !== i),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                variant="ghost"
                disabled={form.services.length >= LIMITS.services}
                onClick={() =>
                  set("services", [...form.services, { name: "", desc: "" }])
                }
              >
                + Add a service
              </Button>
              <TextAreaField
                label="How do customers order or get started?"
                rows={2}
                maxLength={LIMITS.steps}
                value={form.steps}
                error={errors.steps}
                onChange={(e) => set("steps", e.target.value)}
              />
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-white">
                5. About the business
              </h3>
              <TextAreaField
                label="Short introduction"
                hint="2 to 4 true sentences."
                maxLength={LIMITS.about}
                value={form.about}
                error={errors.about}
                onChange={(e) => set("about", e.target.value)}
              />
              <TextAreaField
                label="Year started, team size, awards"
                hint="Only if real and wanted on the site."
                rows={2}
                maxLength={LIMITS.facts}
                value={form.facts}
                error={errors.facts}
                onChange={(e) => set("facts", e.target.value)}
              />
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-white">
                6. Look and feel
              </h3>
              <TextField
                label="Brand colours"
                hint={'Names or hex codes, or "choose for me".'}
                maxLength={LIMITS.colors}
                value={form.colors}
                error={errors.colors}
                onChange={(e) => set("colors", e.target.value)}
              />
              <Chips
                label="Style"
                options={STYLE_OPTIONS}
                value={form.styles}
                onChange={(v) => set("styles", v)}
              />
              <TextAreaField
                label="Websites they like"
                rows={2}
                maxLength={LIMITS.likes}
                value={form.likes}
                error={errors.likes}
                onChange={(e) => set("likes", e.target.value)}
              />
              <Chips
                label="Photos and logo"
                options={PHOTO_OPTIONS}
                value={form.photos}
                onChange={(v) => set("photos", v)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <h3 className="text-sm font-semibold text-white sm:col-span-2">
                7. Practical
              </h3>
              <TextField
                label="Domain name"
                maxLength={LIMITS.domain}
                value={form.domain}
                error={errors.domain}
                onChange={(e) => set("domain", e.target.value)}
              />
              <TextField
                label="Deadline"
                maxLength={LIMITS.deadline}
                value={form.deadline}
                error={errors.deadline}
                onChange={(e) => set("deadline", e.target.value)}
              />
              <div className="sm:col-span-2">
                <TextAreaField
                  label="Anything we must NOT say or show?"
                  rows={2}
                  maxLength={LIMITS.avoid}
                  value={form.avoid}
                  error={errors.avoid}
                  onChange={(e) => set("avoid", e.target.value)}
                />
              </div>
            </div>
          </form>
        </Modal>
      )}

      {importOpen && (
        <Modal
          title="Paste client summary"
          onClose={() => setImportOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setImportOpen(false)}>
                Cancel
              </Button>
              <Button onClick={runImport} disabled={!pasted.trim()}>
                Review and save
              </Button>
            </>
          }
        >
          <TextAreaField
            label="Summary text"
            hint="Paste the full text the client sent from the intake form. You can check and edit it before it is saved."
            rows={12}
            maxLength={20000}
            value={pasted}
            error={importError}
            onChange={(e) => setPasted(e.target.value)}
          />
        </Modal>
      )}

      {viewing && (
        <Modal
          size="lg"
          title={`Summary: ${viewing.businessName}`}
          onClose={() => setViewing(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => download(viewing)}>
                Download
              </Button>
              <Button
                variant="ghost"
                onClick={() => void copy(buildBrief(viewing))}
              >
                Copy build brief
              </Button>
              <Button onClick={() => void copy(buildSummary(viewing))}>
                Copy
              </Button>
            </>
          }
        >
          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-300">
            {buildSummary(viewing)}
          </pre>
        </Modal>
      )}
    </section>
  );
}
