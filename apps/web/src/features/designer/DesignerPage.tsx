import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { writeAudit } from "../../lib/audit";
import { DrivePicker, DriveDownloadButton } from "../digital/DrivePicker";
import { loadTasks } from "../../lib/data";
import { db } from "../../lib/firebase";
import { toDate, fmtDate } from "../../lib/format";
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

type TaskStatus = "todo" | "in_progress" | "done";
type DesignTask = {
  id: string;
  title: string;
  description: string;
  department: string;
  assigneeId: string;
  status: TaskStatus;
  priority?: string;
  dueDate?: unknown;
};
type Post = {
  id: string;
  title: string;
  channel: string;
  caption: string;
  scheduledAt: string;
  status: string;
  assetUrl: string;
  reviewerNote?: string;
};
type Asset = {
  id: string;
  name: string;
  category: string;
  platform: string;
  assetUrl: string;
  driveFileId?: string;
  notes: string;
};

type Tab = "My work" | "Content drafts" | "Asset library";
const TABS: Tab[] = ["My work", "Content drafts", "Asset library"];

const CHANNELS = [
  "Facebook",
  "Instagram",
  "LinkedIn",
  "TikTok",
  "X",
  "YouTube",
  "Website",
];
const ASSET_CATEGORIES = [
  "Image",
  "Video",
  "Document",
  "Logo",
  "Template",
  "Other",
];
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};
const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "done"];

const blankPost = {
  title: "",
  channel: "Facebook",
  caption: "",
  scheduledAt: "",
  assetUrl: "",
};
const blankAsset = {
  name: "",
  category: "Image",
  platform: "General",
  assetUrl: "",
  notes: "",
};

const validUrl = (s: string) => {
  try {
    return ["https:", "http:"].includes(new URL(s).protocol);
  } catch {
    return false;
  }
};

const postTone = (status: string): Tone => {
  if (status === "published" || status === "approved") return "green";
  if (status === "scheduled" || status === "pending_approval") return "blue";
  if (status === "rejected") return "red";
  return "slate";
};
const taskTone = (status: TaskStatus): Tone =>
  status === "done" ? "green" : status === "in_progress" ? "blue" : "amber";
const label = (s: string) => s.replaceAll("_", " ");

function Metric({
  title,
  value,
  detail,
  accent,
}: {
  title: string;
  value: number;
  detail: string;
  accent: string;
}) {
  return (
    <article className="metric-card">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-400">{title}</p>
        <span className={`h-2 w-2 rounded-full ${accent}`} />
      </div>
      <p className="mt-5 text-3xl font-semibold tracking-tight text-white">
        {value}
      </p>
      <p className="mt-2 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

export function DesignerPage() {
  const { user, role } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("My work");
  const [tasks, setTasks] = useState<DesignTask[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState("");

  const [taskFilter, setTaskFilter] = useState<"open" | "all">("open");
  const [assetSearch, setAssetSearch] = useState("");
  const [assetCategory, setAssetCategory] = useState("all");

  const [post, setPost] = useState(blankPost);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [asset, setAsset] = useState(blankAsset);
  const [assetOpen, setAssetOpen] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user || !role) return;
    setLoading(true);
    setError("");
    try {
      const [taskList, postSnap, assetSnap] = await Promise.all([
        loadTasks({ uid: user.uid, role }, true),
        getDocs(
          role === "designer"
            ? query(
                collection(db, "socialPosts"),
                where("createdBy", "==", user.uid),
              )
            : collection(db, "socialPosts"),
        ),
        getDocs(collection(db, "contentAssets")),
      ]);
      setTasks(
        (taskList as DesignTask[]).filter(
          (t) => t.department === "creative" || t.assigneeId === user.uid,
        ),
      );
      setPosts(
        postSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Post)
          .sort((a, b) => (a.scheduledAt || "").localeCompare(b.scheduledAt || "")),
      );
      setAssets(assetSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Asset));
    } catch {
      setError(
        "Some design records could not be loaded. Check your connection or access permissions.",
      );
    } finally {
      setLoading(false);
    }
  }, [user, role]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      toast(ok, "success");
    } catch {
      setError("Save failed. Check required fields, permissions and connection.");
    } finally {
      setBusy(false);
    }
  }

  async function changeTaskStatus(item: DesignTask, status: TaskStatus) {
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
      setTasks((current) =>
        current.map((t) => (t.id === item.id ? { ...t, status } : t)),
      );
      toast(`Marked as ${STATUS_LABEL[status].toLowerCase()}.`, "success");
    } catch {
      setError("That task could not be updated. You may not have permission to change it.");
    } finally {
      setUpdatingId("");
    }
  }

  function openNewPost() {
    setEditingId(null);
    setPost(blankPost);
    setPostOpen(true);
  }
  function openEditPost(p: Post) {
    setEditingId(p.id);
    setPost({
      title: p.title,
      channel: p.channel,
      caption: p.caption,
      scheduledAt: p.scheduledAt,
      assetUrl: p.assetUrl,
    });
    setPostOpen(true);
  }

  async function submitPost(e: FormEvent) {
    e.preventDefault();
    if (
      !user ||
      !post.title.trim() ||
      !post.caption.trim() ||
      (post.assetUrl && !validUrl(post.assetUrl))
    ) {
      setError("Enter a title, a caption and a valid asset URL if you add one.");
      return;
    }
    await save(async () => {
      const fields = {
        ...post,
        title: post.title.trim(),
        caption: post.caption.trim(),
      };
      if (editingId) {
        await updateDoc(doc(db, "socialPosts", editingId), {
          ...fields,
          updatedBy: user.uid,
          updatedAt: serverTimestamp(),
        });
        await writeAudit(user.uid, "digital.post_updated", "socialPost", editingId);
      } else {
        const r = await addDoc(collection(db, "socialPosts"), {
          ...fields,
          status: "draft",
          reviewerNote: "",
          createdBy: user.uid,
          updatedBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await writeAudit(user.uid, "digital.post_created", "socialPost", r.id);
      }
      setPostOpen(false);
      setEditingId(null);
      setPost(blankPost);
    }, editingId ? "Draft updated." : "Draft created.");
  }

  async function submitForApproval(p: Post) {
    if (!user) return;
    await save(async () => {
      await updateDoc(doc(db, "socialPosts", p.id), {
        status: "pending_approval",
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      await writeAudit(
        user.uid,
        "digital.post_pending_approval",
        "socialPost",
        p.id,
      );
    }, "Sent for approval.");
  }

  async function submitAsset(e: FormEvent) {
    e.preventDefault();
    if (!user || !asset.name.trim() || !validUrl(asset.assetUrl)) {
      setError("Enter an asset name and a valid HTTP(S) URL.");
      return;
    }
    await save(async () => {
      const r = await addDoc(collection(db, "contentAssets"), {
        ...asset,
        name: asset.name.trim(),
        createdBy: user.uid,
        updatedBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeAudit(
        user.uid,
        "digital.asset_link_added",
        "contentAsset",
        r.id,
      );
      setAsset(blankAsset);
      setAssetOpen(false);
    }, "Asset link added.");
  }

  const myTasks = useMemo(
    () => tasks.filter((t) => t.assigneeId === user?.uid),
    [tasks, user],
  );
  const teamTasks = useMemo(
    () => tasks.filter((t) => t.assigneeId !== user?.uid),
    [tasks, user],
  );
  const visible = (list: DesignTask[]) =>
    taskFilter === "open" ? list.filter((t) => t.status !== "done") : list;

  const needsRevision = posts.filter((p) => p.status === "rejected").length;
  const awaiting = posts.filter((p) => p.status === "pending_approval").length;
  const openMine = myTasks.filter((t) => t.status !== "done").length;

  const filteredAssets = assets.filter(
    (a) =>
      (assetCategory === "all" || a.category === assetCategory) &&
      `${a.name} ${a.platform} ${a.notes}`
        .toLowerCase()
        .includes(assetSearch.toLowerCase()),
  );

  const renderTasks = (list: DesignTask[], empty: string) => {
    if (list.length === 0)
      return <EmptyState title={empty} text="Nothing to action here right now." />;
    return (
      <div className="grid gap-3">
        {list.map((item) => {
          const due = toDate(item.dueDate);
          const mine = item.assigneeId === user?.uid;
          return (
            <article key={item.id} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-white">{item.title}</h3>
                  {item.description && (
                    <p className="mt-1 text-sm text-slate-400">
                      {item.description}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    {item.priority ? `${item.priority} priority` : "No priority"}
                    {due ? ` · due ${fmtDate(due)}` : ""}
                  </p>
                </div>
                <StatusPill tone={taskTone(item.status)}>
                  {STATUS_LABEL[item.status]}
                </StatusPill>
              </div>
              {mine && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {STATUS_ORDER.map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={Boolean(updatingId)}
                      onClick={() => void changeTaskStatus(item, status)}
                      className={`inline-flex min-h-10 items-center rounded-lg border px-3 text-xs font-semibold transition disabled:opacity-50 ${
                        item.status === status
                          ? "border-sky-400/40 bg-sky-400/10 text-sky-200"
                          : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
                      }`}
                    >
                      {STATUS_LABEL[status]}
                    </button>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <section>
      <PageHeader
        eyebrow="Creative"
        title="Design studio"
        description="Your design tasks, content drafts and the shared brand asset library in one place."
        actions={
          <>
            <Link
              to="/tasks"
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-700 px-4 text-sm font-semibold text-slate-200 hover:border-[#2E9BFF] hover:text-white"
            >
              Full task board
            </Link>
            <Button onClick={openNewPost}>New content draft</Button>
          </>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <LoadingState label="Loading your studio…" />
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              title="Open tasks"
              value={openMine}
              detail="Assigned to you"
              accent="bg-sky-400"
            />
            <Metric
              title="Needs revision"
              value={needsRevision}
              detail="Rejected drafts with feedback"
              accent="bg-amber-400"
            />
            <Metric
              title="Awaiting approval"
              value={awaiting}
              detail="Submitted for review"
              accent="bg-emerald-400"
            />
            <Metric
              title="Library assets"
              value={assets.length}
              detail="Shared brand links"
              accent="bg-violet-400"
            />
          </div>

          <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-800">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`min-h-11 whitespace-nowrap border-b-2 px-4 text-sm font-medium transition ${
                  tab === t
                    ? "border-[#2E9BFF] text-white"
                    : "border-transparent text-slate-500 hover:text-slate-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "My work" && (
            <div className="space-y-8">
              <div className="flex justify-end">
                <SelectField
                  label="Show"
                  value={taskFilter}
                  onChange={(e) =>
                    setTaskFilter(e.target.value as "open" | "all")
                  }
                  options={[
                    { value: "open", label: "Open only" },
                    { value: "all", label: "Include done" },
                  ]}
                />
              </div>
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
                  Assigned to me
                </h2>
                {renderTasks(visible(myTasks), "No tasks assigned to you")}
              </div>
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
                  Creative team
                </h2>
                {renderTasks(visible(teamTasks), "No other creative tasks")}
              </div>
            </div>
          )}

          {tab === "Content drafts" && (
            <div className="space-y-4">
              {posts.length === 0 ? (
                <EmptyState
                  title="No content drafts yet"
                  text="Create a draft, then send it for approval when it is ready."
                  action={<Button onClick={openNewPost}>New content draft</Button>}
                />
              ) : (
                posts.map((p) => {
                  const editable =
                    p.status === "draft" || p.status === "rejected";
                  return (
                    <article key={p.id} className="panel p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-white">{p.title}</h3>
                          <p className="mt-1 text-xs text-slate-500">
                            {p.channel} · {p.scheduledAt || "No date set"}
                          </p>
                        </div>
                        <StatusPill tone={postTone(p.status)}>
                          {label(p.status)}
                        </StatusPill>
                      </div>
                      <p className="mt-3 line-clamp-3 text-sm text-slate-400">
                        {p.caption}
                      </p>
                      {p.status === "rejected" && p.reviewerNote && (
                        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                          Feedback: {p.reviewerNote}
                        </p>
                      )}
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {editable && (
                          <>
                            <Button
                              variant="ghost"
                              disabled={busy}
                              onClick={() => openEditPost(p)}
                            >
                              Edit
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() => void submitForApproval(p)}
                            >
                              Send for approval
                            </Button>
                          </>
                        )}
                        {p.assetUrl && (
                          <a
                            href={p.assetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-sky-300 underline"
                          >
                            Open creative
                          </a>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          )}

          {tab === "Asset library" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="grid flex-1 gap-3 sm:max-w-xl sm:grid-cols-2">
                  <TextField
                    label="Search"
                    placeholder="Name, platform or notes"
                    value={assetSearch}
                    onChange={(e) => setAssetSearch(e.target.value)}
                  />
                  <SelectField
                    label="Category"
                    value={assetCategory}
                    onChange={(e) => setAssetCategory(e.target.value)}
                    options={[
                      { value: "all", label: "All categories" },
                      ...ASSET_CATEGORIES.map((value) => ({ value, label: value })),
                    ]}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => setDriveOpen(true)}>
                    From Google Drive
                  </Button>
                  <Button
                    onClick={() => {
                      setAsset(blankAsset);
                      setAssetOpen(true);
                    }}
                  >
                    Add asset link
                  </Button>
                </div>
              </div>
              {filteredAssets.length === 0 ? (
                <EmptyState
                  title="No assets found"
                  text="Add files from Google Drive or link external creative files and templates here. Files are kept in Drive, not Firebase."
                />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filteredAssets.map((a) => (
                    <article key={a.id} className="panel p-4">
                      <h3 className="font-semibold text-white">{a.name}</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {[a.category, a.platform, a.driveFileId && "Google Drive"]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {a.notes && (
                        <p className="mt-2 text-sm text-slate-400">{a.notes}</p>
                      )}
                      <a
                        href={a.assetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-block text-xs text-sky-300 underline"
                      >
                        Open asset
                      </a>
                      {a.driveFileId && (
                        <DriveDownloadButton id={a.driveFileId} name={a.name} />
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {postOpen && (
        <Modal
          title={editingId ? "Edit content draft" : "New content draft"}
          onClose={() => !busy && setPostOpen(false)}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setPostOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" form="designer-post-form" disabled={busy}>
                {busy ? "Saving…" : editingId ? "Save changes" : "Create draft"}
              </Button>
            </>
          }
        >
          <form
            id="designer-post-form"
            onSubmit={submitPost}
            className="grid gap-4"
          >
            <TextField
              label="Title"
              required
              maxLength={160}
              value={post.title}
              onChange={(e) => setPost({ ...post, title: e.target.value })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Channel"
                value={post.channel}
                onChange={(e) => setPost({ ...post, channel: e.target.value })}
                options={CHANNELS.map((value) => ({ value, label: value }))}
              />
              <TextField
                label="Scheduled for"
                type="datetime-local"
                value={post.scheduledAt}
                onChange={(e) =>
                  setPost({ ...post, scheduledAt: e.target.value })
                }
              />
            </div>
            <TextAreaField
              label="Caption"
              required
              rows={4}
              maxLength={4000}
              value={post.caption}
              onChange={(e) => setPost({ ...post, caption: e.target.value })}
            />
            <TextField
              label="Creative URL"
              type="url"
              hint="Optional link to the design file or exported creative."
              value={post.assetUrl}
              onChange={(e) => setPost({ ...post, assetUrl: e.target.value })}
            />
          </form>
        </Modal>
      )}

      {driveOpen && user && (
        <DrivePicker
          uid={user.uid}
          existingIds={
            new Set(assets.map((a) => a.driveFileId).filter(Boolean) as string[])
          }
          onAdded={() => void load()}
          onClose={() => setDriveOpen(false)}
        />
      )}

      {assetOpen && (
        <Modal
          title="Add asset link"
          onClose={() => !busy && setAssetOpen(false)}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setAssetOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" form="designer-asset-form" disabled={busy}>
                {busy ? "Saving…" : "Add link"}
              </Button>
            </>
          }
        >
          <form
            id="designer-asset-form"
            onSubmit={submitAsset}
            className="grid gap-4"
          >
            <TextField
              label="Name"
              required
              maxLength={160}
              value={asset.name}
              onChange={(e) => setAsset({ ...asset, name: e.target.value })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Category"
                value={asset.category}
                onChange={(e) =>
                  setAsset({ ...asset, category: e.target.value })
                }
                options={ASSET_CATEGORIES.map((value) => ({
                  value,
                  label: value,
                }))}
              />
              <TextField
                label="Platform"
                maxLength={80}
                value={asset.platform}
                onChange={(e) =>
                  setAsset({ ...asset, platform: e.target.value })
                }
              />
            </div>
            <TextField
              label="Asset URL"
              type="url"
              required
              value={asset.assetUrl}
              onChange={(e) => setAsset({ ...asset, assetUrl: e.target.value })}
            />
            <TextAreaField
              label="Notes"
              rows={3}
              maxLength={1500}
              value={asset.notes}
              onChange={(e) => setAsset({ ...asset, notes: e.target.value })}
            />
          </form>
        </Modal>
      )}
    </section>
  );
}
