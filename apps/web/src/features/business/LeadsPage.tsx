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

type Stage = "New" | "Contacted" | "Proposal" | "Won" | "Lost";
type Lead = {
  id: string;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  source: string;
  stage: Stage;
  notes: string;
  nextFollowUpAt: string;
};

const stages: Stage[] = ["New", "Contacted", "Proposal", "Won", "Lost"];
const sources = ["Website", "Referral", "Cold outreach", "Event", "Social", "Other"];
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const blank = () => ({
  company: "",
  contactName: "",
  email: "",
  phone: "",
  source: "Website",
  notes: "",
  nextFollowUpAt: "",
});

function stageTone(stage: Stage): Tone {
  if (stage === "Won") return "green";
  if (stage === "Lost") return "red";
  if (stage === "Proposal") return "blue";
  if (stage === "Contacted") return "amber";
  return "slate";
}

export function LeadsPage() {
  const { user, role } = useAuth();
  const toast = useToast();
  const canManage = canManageBusiness(role);
  const [items, setItems] = useState<Lead[]>([]);
  const [form, setForm] = useState(blank);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("All");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    const snap = await getDocs(
      query(collection(db, "leads"), orderBy("updatedAt", "desc"), limit(150)),
    );
    setItems(
      snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Lead, "id">) })),
    );
  }

  useEffect(() => {
    setLoading(true);
    void load()
      .catch(() =>
        setError("Could not load leads. Check your access and connection."),
      )
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () =>
      items.filter(
        (x) =>
          (stageFilter === "All" || x.stage === stageFilter) &&
          `${x.company} ${x.contactName} ${x.email}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [items, search, stageFilter],
  );

  const counts = useMemo(() => {
    const base: Record<string, number> = { All: items.length };
    for (const stage of stages) base[stage] = 0;
    for (const item of items) base[item.stage] = (base[item.stage] ?? 0) + 1;
    return base;
  }, [items]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!user || !form.company.trim() || !form.contactName.trim()) return;
    if (form.email.trim() && !EMAIL_OK.test(form.email.trim())) {
      setError("Enter a valid email address or leave it blank.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (editingId) {
        await updateDoc(doc(db, "leads", editingId), {
          company: form.company.trim(),
          contactName: form.contactName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          source: form.source,
          notes: form.notes.trim(),
          nextFollowUpAt: form.nextFollowUpAt,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });
        await writeAudit(user.uid, "lead.updated", "lead", editingId);
        setEditingId(null);
        setCreateOpen(false);
        setForm(blank());
        await load();
        toast("Lead updated.", "success");
        return;
      }
      const ref = await addDoc(collection(db, "leads"), {
        ...form,
        company: form.company.trim(),
        contactName: form.contactName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        notes: form.notes.trim(),
        stage: "New" as Stage,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      await writeAudit(user.uid, "lead.created", "lead", ref.id);
      void notify("lead.created", ref.id);
      setForm(blank());
      setCreateOpen(false);
      await load();
      toast("Lead added.", "success");
    } catch {
      setError(
        "Lead could not be saved. Verify your role and required fields.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeStage(item: Lead, stage: Stage) {
    if (!user || stage === item.stage) return;
    try {
      await updateDoc(doc(db, "leads", item.id), {
        stage,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      await writeAudit(user.uid, "lead.stage_changed", "lead", item.id);
      await load();
      toast(`Stage set to ${stage}.`, "success");
    } catch {
      setError("Stage update failed. Check your permissions.");
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="Business development"
        title="Leads"
        description={
          canManage
            ? "Manual pipeline for Admin and BizOps. Track follow-ups and move deals through stages."
            : "Your access to the sales pipeline is restricted."
        }
        actions={
          <Button
            onClick={() => {
              setForm(blank());
              setEditingId(null);
              setCreateOpen(true);
            }}
          >
            Add lead
          </Button>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {(["All", ...stages] as const).map((stage) => (
          <button
            key={stage}
            type="button"
            onClick={() => setStageFilter(stage)}
            className={`metric-card text-left ${
              stageFilter === stage ? "ring-1 ring-sky-400/30" : ""
            }`}
          >
            <p className="text-xs text-slate-500">{stage}</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {counts[stage] ?? 0}
            </p>
          </button>
        ))}
      </div>

      <div className="panel p-4">
        <TextField
          label="Search"
          placeholder="Company, contact or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <LoadingState label="Loading leads…" rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No leads found"
          text="Add a lead or clear filters to see the pipeline."
          action={
            <Button
              onClick={() => {
                setForm(blank());
                setEditingId(null);
                setCreateOpen(true);
              }}
            >
              Add lead
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map((item) => (
            <article key={item.id} className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-white">{item.company}</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    {item.contactName}
                  </p>
                </div>
                <StatusPill tone={stageTone(item.stage)}>
                  {item.stage}
                </StatusPill>
              </div>
              <div className="mt-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                <p>{item.email || "No email"}</p>
                <p>{item.phone || "No phone"}</p>
                <p>Source: {item.source || "—"}</p>
                <p>
                  Follow-up: {item.nextFollowUpAt || "Not scheduled"}
                </p>
              </div>
              {item.notes && (
                <p className="mt-3 border-t border-slate-800 pt-3 text-sm text-slate-400">
                  {item.notes}
                </p>
              )}
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <SelectField
                  label="Stage"
                  value={item.stage}
                  onChange={(e) =>
                    void changeStage(item, e.target.value as Stage)
                  }
                  options={stages.map((value) => ({ value, label: value }))}
                />
                <Button
                  variant="ghost"
                  className="sm:mb-0.5"
                  onClick={() => {
                    setForm({
                      company: item.company,
                      contactName: item.contactName,
                      email: item.email,
                      phone: item.phone,
                      source: item.source,
                      notes: item.notes,
                      nextFollowUpAt: item.nextFollowUpAt,
                    });
                    setEditingId(item.id);
                    setCreateOpen(true);
                  }}
                >
                  Edit
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {createOpen && (
        <Modal
          title={editingId ? "Edit lead" : "Add lead"}
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
              <Button type="submit" form="lead-create-form" disabled={busy}>
                {busy ? "Saving…" : editingId ? "Save changes" : "Save lead"}
              </Button>
            </>
          }
        >
          <form
            id="lead-create-form"
            onSubmit={create}
            className="grid gap-4 sm:grid-cols-2"
          >
            <TextField
              label="Company"
              required
              maxLength={160}
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
            <TextField
              label="Primary contact"
              required
              maxLength={160}
              value={form.contactName}
              onChange={(e) =>
                setForm({ ...form, contactName: e.target.value })
              }
            />
            <TextField
              label="Email"
              type="email"
              maxLength={254}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <TextField
              label="Phone"
              maxLength={40}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <SelectField
              label="Source"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              options={sources.map((value) => ({ value, label: value }))}
            />
            <TextField
              label="Next follow-up"
              type="date"
              value={form.nextFollowUpAt}
              onChange={(e) =>
                setForm({ ...form, nextFollowUpAt: e.target.value })
              }
            />
            <div className="sm:col-span-2">
              <TextAreaField
                label="Notes"
                rows={3}
                maxLength={3000}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
