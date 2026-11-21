import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../../app/AuthProvider";
import { writeAudit } from "../../lib/audit";
import { notify } from "../../lib/notify";
import { loadUsers } from "../../lib/data";
import { db } from "../../lib/firebase";
import { useToast } from "../../lib/toast";
import { ConfirmDialog } from "../../lib/ui";
import { canManageAnnouncements } from "../../lib/roles";

type Item = {
  id: string;
  title: string;
  body: string;
  status?: string;
  createdAt?: { toDate?: () => Date } | string | null;
  createdBy?: string;
};

const formatDate = (value: Item["createdAt"]) => {
  if (!value) return "Recently";
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "Recently" : parsed.toLocaleString();
  }
  if (typeof value.toDate === "function") {
    return value.toDate().toLocaleString();
  }
  return "Recently";
};

export function AnnouncementsPage() {
  const { user, role } = useAuth();
  const canPublish = canManageAnnouncements(role);
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const toast = useToast();
  const [names, setNames] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadUsers()
      .then((profiles) =>
        setNames(Object.fromEntries(profiles.map((p) => [p.id, p.name || p.workEmail]))),
      )
      .catch(() => setNames({}));
  }, []);

  async function remove(item: Item) {
    if (!user) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "announcements", item.id));
      await writeAudit(user.uid, "announcement.deleted", "announcement", item.id);
      setDeleting(null);
      await load();
      toast("Announcement deleted.", "success");
    } catch {
      setMessage("Announcement could not be deleted.");
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    const result = await getDocs(
      query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(50)),
    );
    setItems(
      result.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<Item, "id">),
      })),
    );
  }

  useEffect(() => {
    void load().catch(() => setMessage("Could not load announcements."));
  }, []);

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (!term) return true;
      return [item.title, item.body, names[item.createdBy ?? ""] ?? ""].some((value) =>
        String(value ?? "").toLowerCase().includes(term),
      );
    });
  }, [items, search, names]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user || !title.trim() || !body.trim()) return;
    try {
      const ref = await addDoc(collection(db, "announcements"), {
        title: title.trim(),
        body: body.trim(),
        status: "published",
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      await writeAudit(
        user.uid,
        "announcement.created",
        "announcement",
        ref.id,
      );
      void notify("announcement.created", ref.id);
      setTitle("");
      setBody("");
      setMessage("Announcement published.");
      await load();
    } catch {
      setMessage("Announcement could not be published.");
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">COMMUNICATIONS</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Announcements</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-400">Keep the team aligned with published updates and priority information.</p>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300">{items.filter((item) => (item.status ?? "published") === "published").length} published</span>
      </div>

      {canPublish && (
        <form
          className="panel space-y-4 p-5 sm:p-6"
          onSubmit={submit}
        >
          <div>
            <p className="eyebrow">PUBLISH UPDATE</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Create announcement</h2>
          </div>
          <label className="block text-sm text-slate-300">
            Title
            <input
              className="mt-2 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-sky-400"
              maxLength={200}
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="block text-sm text-slate-300">
            Message
            <textarea
              className="mt-2 min-h-[120px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
              maxLength={4000}
              required
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">Visible to the full workspace once published.</span>
            <button type="submit" className="primary-action">Publish update</button>
          </div>
        </form>
      )}

      <div className="panel p-4">
        <label className="block text-xs font-medium text-slate-400">
          Search announcements
          <input
            className="mt-2 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-sky-400"
            value={search}
            placeholder="Title, message or posted by…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {message && (
        <p role="alert" className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">
          {message}
        </p>
      )}

      {visibleItems.length ? (
        <div className="space-y-4">
          {visibleItems.map((item) => (
            <article className="panel p-5 sm:p-6" key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Published update</p>
                  <h2 className="mt-2 text-xl font-semibold text-white">{item.title}</h2>
                </div>
                <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-emerald-200">
                  {item.status || "published"}
                </span>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-300">{item.body}</p>
              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                <span>{formatDate(item.createdAt)}</span>
                {item.createdBy && <span>Posted by {names[item.createdBy] || "a former team member"}</span>}
                {role === "admin" && (
                  <button type="button" className="text-red-300 hover:text-red-200" onClick={() => setDeleting(item)}>
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel px-6 py-14 text-center">
          <h3 className="font-semibold text-white">No matching announcements</h3>
          <p className="mt-2 text-sm text-slate-500">Try adjusting your search, or publish a new update.</p>
        </div>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete announcement?"
          message={`“${deleting.title}” will be removed for everyone. This cannot be undone.`}
          confirmLabel="Delete"
          tone="danger"
          busy={busy}
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
