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
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { useAuth } from "../../app/AuthProvider";
import { writeAudit } from "../../lib/audit";
import { DrivePicker, DriveDownloadButton } from "./DrivePicker";
import { db } from "../../lib/firebase";
import {
  canCreateDigitalContent,
  canManageCampaigns,
  canManageDigital,
} from "../../lib/roles";
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

type Post = {
  id: string;
  title: string;
  channel: string;
  caption: string;
  scheduledAt: string;
  status: string;
  assetUrl: string;
  reviewerNote?: string;
  createdBy: string;
};
type RequestItem = {
  id: string;
  title: string;
  description: string;
  pageUrl: string;
  priority: string;
  status: string;
  completionNote?: string;
  createdBy: string;
};
type Campaign = {
  id: string;
  name: string;
  objective: string;
  channels: string[];
  startDate: string;
  endDate: string;
  budgetZmw: number;
  status: string;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
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

type Tab =
  | "Calendar"
  | "Approvals"
  | "Website requests"
  | "Campaigns"
  | "Reports"
  | "Asset library";

const channels = [
  "Facebook",
  "Instagram",
  "LinkedIn",
  "TikTok",
  "X",
  "YouTube",
  "Website",
];

const blankPost = {
  title: "",
  channel: "Facebook",
  caption: "",
  scheduledAt: "",
  assetUrl: "",
};
const blankRequest = {
  title: "",
  description: "",
  pageUrl: "",
  priority: "Normal",
};
const blankCampaign = {
  name: "",
  objective: "Awareness",
  channels: ["Facebook"] as string[],
  startDate: "",
  endDate: "",
  budgetZmw: "0",
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

const stamp = () => ({
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

const money = (n: number) =>
  new Intl.NumberFormat("en-ZM", {
    style: "currency",
    currency: "ZMW",
    maximumFractionDigits: 0,
  }).format(n || 0);

function postTone(status: string): Tone {
  if (status === "published" || status === "approved") return "green";
  if (status === "scheduled" || status === "pending_approval") return "blue";
  if (status === "rejected") return "red";
  return "slate";
}

function requestTone(status: string): Tone {
  if (status === "completed") return "green";
  if (status === "in_progress" || status === "triaged") return "blue";
  if (status === "rejected") return "red";
  return "amber";
}

const PRIORITY_RANK: Record<string, number> = {
  Urgent: 0,
  High: 1,
  Normal: 2,
  Low: 3,
};
const POST_CHIP: Record<string, string> = {
  draft: "bg-slate-700/40 text-slate-300",
  pending_approval: "bg-amber-400/15 text-amber-200",
  approved: "bg-emerald-400/15 text-emerald-200",
  scheduled: "bg-sky-400/15 text-sky-200",
  published: "bg-emerald-400/25 text-emerald-100",
  rejected: "bg-red-400/15 text-red-200",
};
const POST_FILTERS = [
  ["all", "All"],
  ["pending_approval", "Awaiting approval"],
  ["approved", "Approved"],
  ["scheduled", "Scheduled"],
  ["published", "Published"],
  ["draft", "Drafts"],
  ["rejected", "Rejected"],
] as const;
const REQUEST_FILTERS = [
  ["open", "Open"],
  ["completed", "Completed"],
  ["rejected", "Rejected"],
  ["all", "All"],
] as const;

function Metric({
  title,
  value,
  detail,
  accent,
}: {
  title: string;
  value: string | number;
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

export function DigitalOperationsPage() {
  const { user, role } = useAuth();
  const toast = useToast();
  const manager = canManageDigital(role);
  const postAccess = canCreateDigitalContent(role);
  const assetAccess = postAccess;
  const campaignAccess = canManageCampaigns(role);

  const [tab, setTab] = useState<Tab>("Approvals");
  const [posts, setPosts] = useState<Post[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [postFilter, setPostFilter] = useState<string>("all");
  const [reqFilter, setReqFilter] = useState<string>("open");
  const [reqSearch, setReqSearch] = useState("");
  const [closing, setClosing] = useState<{
    item: RequestItem;
    status: "completed" | "rejected";
  } | null>(null);
  const [closeNote, setCloseNote] = useState("");
  const [rejecting, setRejecting] = useState<Post | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const [post, setPost] = useState(blankPost);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [request, setRequest] = useState(blankRequest);
  const [requestOpen, setRequestOpen] = useState(false);
  const [campaign, setCampaign] = useState(blankCampaign);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [asset, setAsset] = useState(blankAsset);
  const [assetOpen, setAssetOpen] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const [metricsFor, setMetricsFor] = useState<Campaign | null>(null);
  const [metricsForm, setMetricsForm] = useState({
    impressions: "0",
    clicks: "0",
    leads: "0",
    conversions: "0",
  });

  const tabs = useMemo(() => {
    const list: Tab[] = [];
    if (postAccess) list.push("Calendar", "Approvals");
    list.push("Website requests");
    if (campaignAccess) list.push("Campaigns", "Reports");
    if (assetAccess) list.push("Asset library");
    return list;
  }, [postAccess, campaignAccess, assetAccess]);

  useEffect(() => {
    if (!tabs.includes(tab)) setTab(tabs[0] || "Website requests");
  }, [tabs, tab]);

  const load = useCallback(async () => {
    if (!user || !role) return;
    setLoading(true);
    setError("");
    try {
      const postAllowed = canCreateDigitalContent(role);
      const pq = collection(db, "socialPosts");
      const rq = manager
        ? collection(db, "websiteRequests")
        : query(
            collection(db, "websiteRequests"),
            where("createdBy", "==", user.uid),
          );
      const assetAllowed = ["admin", "digitalops", "designer"].includes(role);
      const [p, r, c, a] = await Promise.all([
        postAllowed ? getDocs(pq) : Promise.resolve(null),
        getDocs(rq),
        campaignAccess
          ? getDocs(collection(db, "digitalCampaigns"))
          : Promise.resolve(null),
        assetAllowed
          ? getDocs(collection(db, "contentAssets"))
          : Promise.resolve(null),
      ]);
      setPosts(
        p
          ? p.docs
              .map((d) => ({ id: d.id, ...d.data() }) as Post)
              .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
          : [],
      );
      setRequests(
        r.docs.map((d) => ({ id: d.id, ...d.data() }) as RequestItem),
      );
      setCampaigns(
        c ? c.docs.map((d) => ({ id: d.id, ...d.data() }) as Campaign) : [],
      );
      setAssets(
        a ? a.docs.map((d) => ({ id: d.id, ...d.data() }) as Asset) : [],
      );
    } catch {
      setError(
        "Unable to load some records. Check your role and Firestore rules.",
      );
    } finally {
      setLoading(false);
    }
  }, [user, role, manager, campaignAccess]);

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
      setError(
        "Save failed. Check permissions, required fields and connection.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitPost(e: FormEvent) {
    e.preventDefault();
    if (
      !user ||
      !post.title.trim() ||
      !post.caption.trim() ||
      (post.assetUrl && !validUrl(post.assetUrl))
    ) {
      setError("Enter a title, caption and valid asset URL if provided.");
      return;
    }
    await save(async () => {
      if (editingId) {
        await updateDoc(doc(db, "socialPosts", editingId), {
          ...post,
          title: post.title.trim(),
          caption: post.caption.trim(),
          updatedBy: user.uid,
          updatedAt: serverTimestamp(),
        });
        await writeAudit(
          user.uid,
          "digital.post_updated",
          "socialPost",
          editingId,
        );
      } else {
        const r = await addDoc(collection(db, "socialPosts"), {
          ...post,
          title: post.title.trim(),
          caption: post.caption.trim(),
          status: "draft",
          reviewerNote: "",
          createdBy: user.uid,
          updatedBy: user.uid,
          ...stamp(),
        });
        await writeAudit(
          user.uid,
          "digital.post_created",
          "socialPost",
          r.id,
        );
      }
      setPost(blankPost);
      setEditingId(null);
      setPostOpen(false);
    }, editingId ? "Draft updated." : "Draft saved.");
  }

  async function postState(p: Post, status: string) {
    if (!user) return;
    if (status === "scheduled" && !p.scheduledAt) {
      setError("Set a scheduled date and time on the draft before scheduling it.");
      return;
    }
    if (status === "approved" && p.createdBy === user.uid) {
      setError("You cannot approve your own content.");
      return;
    }
    await save(async () => {
      await updateDoc(doc(db, "socialPosts", p.id), {
        status,
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      await writeAudit(
        user.uid,
        `digital.post_${status}`,
        "socialPost",
        p.id,
      );
    }, `Content moved to ${status.replaceAll("_", " ")}.`);
  }

  async function rejectPost(p: Post, note: string) {
    if (!user) return;
    await save(async () => {
      await updateDoc(doc(db, "socialPosts", p.id), {
        status: "rejected",
        reviewerNote: note.trim().slice(0, 1000),
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      await writeAudit(user.uid, "digital.post_rejected", "socialPost", p.id);
      setRejecting(null);
      setRejectNote("");
    }, "Content rejected with feedback.");
  }

  async function submitRequest(e: FormEvent) {
    e.preventDefault();
    if (
      !user ||
      !request.title.trim() ||
      !request.description.trim() ||
      (request.pageUrl && !validUrl(request.pageUrl))
    ) {
      setError("Enter a title, description and valid page URL if provided.");
      return;
    }
    await save(async () => {
      const r = await addDoc(collection(db, "websiteRequests"), {
        ...request,
        status: "submitted",
        assignedTo: "",
        completionNote: "",
        createdBy: user.uid,
        updatedBy: user.uid,
        ...stamp(),
      });
      await writeAudit(
        user.uid,
        "digital.website_request_created",
        "websiteRequest",
        r.id,
      );
      setRequest(blankRequest);
      setRequestOpen(false);
    }, "Website change request submitted.");
  }

  async function requestState(r: RequestItem, status: string, note?: string) {
    if (!user || !manager) return;
    await save(async () => {
      await updateDoc(doc(db, "websiteRequests", r.id), {
        status,
        ...(note !== undefined
          ? { completionNote: note.trim().slice(0, 2000) }
          : {}),
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      await writeAudit(
        user.uid,
        `digital.website_request_${status}`,
        "websiteRequest",
        r.id,
      );
      setClosing(null);
      setCloseNote("");
    }, `Request moved to ${status.replaceAll("_", " ")}.`);
  }

  async function submitCampaign(e: FormEvent) {
    e.preventDefault();
    if (
      !user ||
      !campaign.name.trim() ||
      !campaign.startDate ||
      !campaign.endDate ||
      campaign.endDate < campaign.startDate ||
      !campaign.channels.length
    ) {
      setError("Complete campaign details and select at least one channel.");
      return;
    }
    const budget = Number(campaign.budgetZmw);
    if (!Number.isFinite(budget) || budget < 0) {
      setError("Enter a valid ZMW budget.");
      return;
    }
    await save(async () => {
      const r = await addDoc(collection(db, "digitalCampaigns"), {
        ...campaign,
        name: campaign.name.trim(),
        budgetZmw: budget,
        status: "planned",
        impressions: 0,
        clicks: 0,
        leads: 0,
        conversions: 0,
        createdBy: user.uid,
        updatedBy: user.uid,
        ...stamp(),
      });
      await writeAudit(
        user.uid,
        "digital.campaign_created",
        "digitalCampaign",
        r.id,
      );
      setCampaign(blankCampaign);
      setCampaignOpen(false);
    }, "Campaign created.");
  }

  async function campaignState(c: Campaign, status: string) {
    if (!user || !campaignAccess) return;
    await save(async () => {
      await updateDoc(doc(db, "digitalCampaigns", c.id), {
        status,
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      await writeAudit(
        user.uid,
        "digital.campaign_status_changed",
        "digitalCampaign",
        c.id,
      );
    }, "Campaign status updated.");
  }

  async function saveMetrics(e: FormEvent) {
    e.preventDefault();
    if (!user || !campaignAccess || !metricsFor) return;
    const impressions = Number(metricsForm.impressions);
    const clicks = Number(metricsForm.clicks);
    const leads = Number(metricsForm.leads);
    const conversions = Number(metricsForm.conversions);
    if (
      ![impressions, clicks, leads, conversions].every(
        (n) => Number.isInteger(n) && n >= 0,
      )
    ) {
      setError("Metrics must be whole numbers zero or greater.");
      return;
    }
    if (clicks > impressions || conversions > leads) {
      setError(
        "Clicks cannot exceed impressions; conversions cannot exceed leads.",
      );
      return;
    }
    await save(async () => {
      await updateDoc(doc(db, "digitalCampaigns", metricsFor.id), {
        impressions,
        clicks,
        leads,
        conversions,
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      await writeAudit(
        user.uid,
        "digital.campaign_metrics_updated",
        "digitalCampaign",
        metricsFor.id,
      );
      setMetricsFor(null);
    }, "Campaign metrics saved.");
  }

  async function submitAsset(e: FormEvent) {
    e.preventDefault();
    if (!user || !asset.name.trim() || !validUrl(asset.assetUrl)) {
      setError("Enter an asset name and valid HTTP(S) URL.");
      return;
    }
    await save(async () => {
      const r = await addDoc(collection(db, "contentAssets"), {
        ...asset,
        name: asset.name.trim(),
        createdBy: user.uid,
        updatedBy: user.uid,
        ...stamp(),
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

  const monthStart = new Date(`${month}-01T00:00:00`);
  const days = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() + 1,
    0,
  ).getDate();
  const offset = (monthStart.getDay() + 6) % 7;
  const monthPosts = posts.filter((p) => p.scheduledAt.startsWith(month));
  const filteredPosts = posts.filter((p) =>
    `${p.title} ${p.caption} ${p.channel}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const pendingApproval = posts.filter((p) => p.status === "pending_approval");
  const postCounts = posts.reduce<Record<string, number>>(
    (acc, p) => ({ ...acc, [p.status]: (acc[p.status] || 0) + 1 }),
    {},
  );
  const statusPosts = filteredPosts.filter(
    (p) => postFilter === "all" || p.status === postFilter,
  );
  const unscheduled = posts.filter(
    (p) => !p.scheduledAt && ["draft", "approved"].includes(p.status),
  );
  const openRequests = requests.filter(
    (r) => !["completed", "rejected"].includes(r.status),
  );
  const visibleRequests = requests
    .filter((r) =>
      reqFilter === "all"
        ? true
        : reqFilter === "open"
          ? !["completed", "rejected"].includes(r.status)
          : r.status === reqFilter,
    )
    .filter((r) =>
      `${r.title} ${r.description}`
        .toLowerCase()
        .includes(reqSearch.toLowerCase()),
    )
    .sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9),
    );
  const activeCampaigns = campaigns.filter((c) => c.status === "active");
  const totals = campaigns.reduce(
    (v, c) => ({
      impressions: v.impressions + c.impressions,
      clicks: v.clicks + c.clicks,
      leads: v.leads + c.leads,
      conversions: v.conversions + c.conversions,
    }),
    { impressions: 0, clicks: 0, leads: 0, conversions: 0 },
  );

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="Growth & digital"
        title="Digital operations"
        description="Content calendar, website change requests, campaigns and asset links — internal workflow only, no live social publishing."
        actions={
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {!loading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            title="Awaiting approval"
            value={pendingApproval.length}
            detail="Content waiting for an admin"
            accent="bg-amber-400"
          />
          <Metric
            title="Scheduled this month"
            value={monthPosts.length}
            detail={`Dated posts in ${month}`}
            accent="bg-sky-400"
          />
          <Metric
            title="Open website requests"
            value={openRequests.length}
            detail="Not yet completed or rejected"
            accent="bg-emerald-400"
          />
          <Metric
            title="Active campaigns"
            value={activeCampaigns.length}
            detail={`${campaigns.length} planned in total`}
            accent="bg-violet-400"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tabs.map((item) => {
          const active = tab === item;
          return (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition ${
                active
                  ? "border-sky-400/40 bg-sky-400/10 text-sky-200"
                  : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
              }`}
            >
              {item}
            </button>
          );
        })}
      </div>

      {loading ? (
        <LoadingState label="Loading digital operations…" rows={5} />
      ) : (
        <>
          {tab === "Calendar" && postAccess && (
            <div className="grid gap-5 xl:grid-cols-[1.3fr_.8fr]">
              <div className="panel p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-semibold text-white">
                      Publishing calendar
                    </h2>
                    <p className="text-xs text-slate-500">
                      Planned posts by scheduled date.
                    </p>
                  </div>
                  <input
                    aria-label="Calendar month"
                    type="month"
                    className="min-h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white"
                    value={month}
                    onChange={(e) => e.target.value && setMonth(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-500">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                    (x) => (
                      <div key={x}>{x}</div>
                    ),
                  )}
                </div>
                <div className="mt-2 grid grid-cols-7 gap-1">
                  {Array.from({ length: offset }, (_, i) => (
                    <div
                      key={`e${i}`}
                      className="min-h-20 rounded bg-slate-950/40"
                    />
                  ))}
                  {Array.from({ length: days }, (_, i) => {
                    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
                    const list = monthPosts.filter((p) =>
                      p.scheduledAt.slice(0, 10) === date,
                    );
                    return (
                      <div
                        key={date}
                        className="min-h-20 overflow-hidden rounded border border-slate-800 bg-slate-950/50 p-1"
                      >
                        <span className="text-[10px] text-slate-500">
                          {i + 1}
                        </span>
                        {list.slice(0, 2).map((p) => (
                          <p
                            key={p.id}
                            title={p.title}
                            className={`mt-1 truncate rounded px-1 py-1 text-[9px] ${POST_CHIP[p.status] || POST_CHIP.draft}`}
                          >
                            {p.title}
                          </p>
                        ))}
                        {list.length > 2 && (
                          <p className="text-[9px] text-slate-500">
                            +{list.length - 2} more
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4">
                {postAccess && (
                  <Button
                    className="w-full"
                    onClick={() => {
                      setPost(blankPost);
                      setEditingId(null);
                      setPostOpen(true);
                    }}
                  >
                    New content draft
                  </Button>
                )}
                <div className="panel p-5">
                  <h2 className="font-semibold text-white">This month</h2>
                  <p className="mt-2 text-3xl font-semibold text-sky-300">
                    {monthPosts.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    scheduled or dated posts
                  </p>
                </div>
                <div className="panel p-5">
                  <h2 className="font-semibold text-white">Needs a date</h2>
                  {unscheduled.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">
                      Every draft and approved post has a date.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {unscheduled.slice(0, 6).map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center justify-between gap-2 text-sm text-slate-300"
                        >
                          <span className="truncate">{p.title}</span>
                          <StatusPill tone={postTone(p.status)}>
                            {p.status.replaceAll("_", " ")}
                          </StatusPill>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === "Approvals" && postAccess && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <TextField
                  label="Search posts"
                  placeholder="Title, caption or channel…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {postAccess && (
                  <Button
                    onClick={() => {
                      setPost(blankPost);
                      setEditingId(null);
                      setPostOpen(true);
                    }}
                  >
                    New draft
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {POST_FILTERS.map(([key, text]) => {
                  const count =
                    key === "all" ? posts.length : postCounts[key] || 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPostFilter(key)}
                      className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-xs font-medium transition ${
                        postFilter === key
                          ? "border-sky-400/40 bg-sky-400/10 text-sky-200"
                          : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
                      }`}
                    >
                      {text}
                      <span className="text-slate-500">{count}</span>
                    </button>
                  );
                })}
              </div>

              {statusPosts.length === 0 ? (
                <EmptyState
                  title="No posts found"
                  text="Create a draft to start the content workflow."
                />
              ) : (
                <div className="space-y-3">
                  {statusPosts.map((p) => (
                    <article key={p.id} className="panel p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-white">
                            {p.title}
                          </h3>
                          <p className="mt-1 text-xs text-slate-500">
                            {p.channel} · {p.scheduledAt || "No date"}
                          </p>
                        </div>
                        <StatusPill tone={postTone(p.status)}>
                          {p.status.replaceAll("_", " ")}
                        </StatusPill>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-400">
                        {p.caption}
                      </p>
                      {p.status === "rejected" && p.reviewerNote && (
                        <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-200">
                          Reviewer feedback: {p.reviewerNote}
                        </p>
                      )}
                      {p.assetUrl && (
                        <a
                          href={p.assetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-block text-xs text-sky-300 underline"
                        >
                          Creative link
                        </a>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {["draft", "rejected"].includes(p.status) &&
                          p.createdBy === user?.uid && (
                            <>
                              <Button
                                variant="subtle"
                                onClick={() => {
                                  setPost({
                                    title: p.title,
                                    channel: p.channel,
                                    caption: p.caption,
                                    scheduledAt: p.scheduledAt,
                                    assetUrl: p.assetUrl,
                                  });
                                  setEditingId(p.id);
                                  setPostOpen(true);
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="subtle"
                                onClick={() =>
                                  void postState(p, "pending_approval")
                                }
                              >
                                Submit for review
                              </Button>
                            </>
                          )}
                        {role === "admin" &&
                          p.status === "pending_approval" &&
                          p.createdBy !== user?.uid && (
                            <>
                              <Button
                                onClick={() => void postState(p, "approved")}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="danger"
                                onClick={() => {
                                  setRejectNote("");
                                  setRejecting(p);
                                }}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                        {role === "admin" &&
                          p.status === "pending_approval" &&
                          p.createdBy === user?.uid && (
                            <p className="text-xs text-amber-300">
                              Waiting for another admin: you cannot approve your own content.
                            </p>
                          )}
                        {manager && p.status === "approved" && (
                          <Button
                            variant="subtle"
                            onClick={() => void postState(p, "scheduled")}
                          >
                            Mark scheduled
                          </Button>
                        )}
                        {manager && p.status === "scheduled" && (
                          <Button
                            variant="subtle"
                            onClick={() => void postState(p, "published")}
                          >
                            Mark published
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {pendingApproval.length > 0 && (
                <p className="text-xs text-slate-500">
                  {pendingApproval.length} post
                  {pendingApproval.length === 1 ? "" : "s"} awaiting approval.
                </p>
              )}
            </div>
          )}

          {tab === "Website requests" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <TextField
                    label="Search requests"
                    placeholder="Title or description…"
                    value={reqSearch}
                    onChange={(e) => setReqSearch(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2 pb-1">
                    {REQUEST_FILTERS.map(([key, text]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setReqFilter(key)}
                        className={`inline-flex min-h-10 items-center rounded-full border px-3 text-xs font-medium transition ${
                          reqFilter === key
                            ? "border-sky-400/40 bg-sky-400/10 text-sky-200"
                            : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
                        }`}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  onClick={() => {
                    setRequest(blankRequest);
                    setRequestOpen(true);
                  }}
                >
                  New website request
                </Button>
              </div>
              {visibleRequests.length === 0 ? (
                <EmptyState
                  title="No website requests"
                  text="Nothing matches this view. Log a change request for the public site or product pages."
                />
              ) : (
                <div className="space-y-3">
                  {visibleRequests.map((r) => (
                    <article key={r.id} className="panel p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-white">
                            {r.title}
                          </h3>
                          <p className="mt-1 text-xs text-slate-500">
                            Priority: {r.priority}
                          </p>
                        </div>
                        <StatusPill tone={requestTone(r.status)}>
                          {r.status.replaceAll("_", " ")}
                        </StatusPill>
                      </div>
                      <p className="mt-3 text-sm text-slate-300">
                        {r.description}
                      </p>
                      {r.completionNote && (
                        <p className="mt-2 rounded-lg border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-300">
                          Note: {r.completionNote}
                        </p>
                      )}
                      {r.pageUrl && (
                        <a
                          href={r.pageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-block text-xs text-sky-300 underline"
                        >
                          Page link
                        </a>
                      )}
                      {manager && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {[
                            "triaged",
                            "in_progress",
                            "completed",
                            "rejected",
                          ].map((s) => (
                            <Button
                              key={s}
                              variant="subtle"
                              disabled={busy || r.status === s}
                              onClick={() =>
                                s === "completed" || s === "rejected"
                                  ? (setCloseNote(r.completionNote || ""),
                                    setClosing({ item: r, status: s }))
                                  : void requestState(r, s)
                              }
                            >
                              {s.replaceAll("_", " ")}
                            </Button>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "Campaigns" && campaignAccess && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    setCampaign(blankCampaign);
                    setCampaignOpen(true);
                  }}
                >
                  New campaign
                </Button>
              </div>
              {campaigns.length === 0 ? (
                <EmptyState
                  title="No campaigns yet"
                  text="Plan a campaign and record metrics manually as results come in."
                />
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {campaigns.map((c) => (
                    <article key={c.id} className="panel p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-white">{c.name}</h3>
                          <p className="mt-1 text-xs text-slate-500">
                            {c.objective} · {c.startDate} → {c.endDate}
                          </p>
                        </div>
                        <StatusPill
                          tone={
                            c.status === "active"
                              ? "green"
                              : c.status === "completed"
                                ? "slate"
                                : c.status === "paused"
                                  ? "amber"
                                  : "blue"
                          }
                        >
                          {c.status}
                        </StatusPill>
                      </div>
                      <p className="mt-3 text-sm text-slate-400">
                        {c.channels?.join(", ")} · Budget {money(c.budgetZmw)}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        {c.impressions} impr · {c.clicks} clicks · {c.leads}{" "}
                        leads · {c.conversions} conversions ·{" "}
                        {c.impressions
                          ? ((c.clicks / c.impressions) * 100).toFixed(2)
                          : "0.00"}
                        % CTR
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {["planned", "active", "paused", "completed"].map(
                          (s) => (
                            <Button
                              key={s}
                              variant="subtle"
                              disabled={busy || c.status === s}
                              onClick={() => void campaignState(c, s)}
                            >
                              {s}
                            </Button>
                          ),
                        )}
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setMetricsForm({
                              impressions: String(c.impressions || 0),
                              clicks: String(c.clicks || 0),
                              leads: String(c.leads || 0),
                              conversions: String(c.conversions || 0),
                            });
                            setMetricsFor(c);
                          }}
                        >
                          Edit metrics
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "Reports" && campaignAccess && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="metric-card">
                <p className="text-xs text-slate-500">Impressions</p>
                <p className="mt-2 text-2xl font-semibold text-white">
                  {totals.impressions}
                </p>
              </div>
              <div className="metric-card">
                <p className="text-xs text-slate-500">Clicks</p>
                <p className="mt-2 text-2xl font-semibold text-sky-300">
                  {totals.clicks}
                </p>
              </div>
              <div className="metric-card">
                <p className="text-xs text-slate-500">Leads</p>
                <p className="mt-2 text-2xl font-semibold text-amber-200">
                  {totals.leads}
                </p>
              </div>
              <div className="metric-card">
                <p className="text-xs text-slate-500">Conversions</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-300">
                  {totals.conversions}
                </p>
              </div>
              <p className="sm:col-span-2 xl:col-span-4 text-xs text-slate-500">
                Manual metrics only. CTR{" "}
                {totals.impressions
                  ? ((totals.clicks / totals.impressions) * 100).toFixed(2)
                  : "0.00"}
                %.
              </p>
            </div>
          )}

          {tab === "Asset library" && assetAccess && (
            <div className="space-y-4">
              <div className="flex flex-wrap justify-end gap-2">
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
              {assets.length === 0 ? (
                <EmptyState
                  title="No assets linked"
                  text="Add files from Google Drive or store external creative URLs and notes here. Files are kept in Drive, not Firebase."
                />
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {assets.map((a) => (
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

      {postOpen && postAccess && (
        <Modal
          title={editingId ? "Edit content draft" : "Create content draft"}
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
              <Button type="submit" form="digital-post-form" disabled={busy}>
                {busy ? "Saving…" : editingId ? "Update draft" : "Save draft"}
              </Button>
            </>
          }
        >
          <form id="digital-post-form" onSubmit={submitPost} className="grid gap-4">
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
                options={channels.map((value) => ({ value, label: value }))}
              />
              <TextField
                label="Schedule"
                type="datetime-local"
                value={post.scheduledAt}
                onChange={(e) =>
                  setPost({ ...post, scheduledAt: e.target.value })
                }
              />
            </div>
            <TextAreaField
              label="Caption / copy"
              required
              rows={4}
              maxLength={4000}
              value={post.caption}
              onChange={(e) => setPost({ ...post, caption: e.target.value })}
            />
            <TextField
              label="Creative URL"
              type="url"
              value={post.assetUrl}
              onChange={(e) => setPost({ ...post, assetUrl: e.target.value })}
              hint="Optional external link to the creative."
            />
          </form>
        </Modal>
      )}

      {requestOpen && (
        <Modal
          title="New website change request"
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
                form="digital-request-form"
                disabled={busy}
              >
                {busy ? "Submitting…" : "Submit request"}
              </Button>
            </>
          }
        >
          <form
            id="digital-request-form"
            onSubmit={submitRequest}
            className="grid gap-4"
          >
            <TextField
              label="Title"
              required
              maxLength={160}
              value={request.title}
              onChange={(e) =>
                setRequest({ ...request, title: e.target.value })
              }
            />
            <TextField
              label="Page URL"
              type="url"
              value={request.pageUrl}
              onChange={(e) =>
                setRequest({ ...request, pageUrl: e.target.value })
              }
            />
            <SelectField
              label="Priority"
              value={request.priority}
              onChange={(e) =>
                setRequest({ ...request, priority: e.target.value })
              }
              options={["Low", "Normal", "High", "Urgent"].map((value) => ({
                value,
                label: value,
              }))}
            />
            <TextAreaField
              label="Description"
              required
              rows={4}
              maxLength={4000}
              value={request.description}
              onChange={(e) =>
                setRequest({ ...request, description: e.target.value })
              }
            />
          </form>
        </Modal>
      )}

      {campaignOpen && campaignAccess && (
        <Modal
          title="New campaign"
          size="lg"
          onClose={() => !busy && setCampaignOpen(false)}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setCampaignOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="digital-campaign-form"
                disabled={busy}
              >
                {busy ? "Saving…" : "Create campaign"}
              </Button>
            </>
          }
        >
          <form
            id="digital-campaign-form"
            onSubmit={submitCampaign}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <TextField
                label="Campaign name"
                required
                value={campaign.name}
                onChange={(e) =>
                  setCampaign({ ...campaign, name: e.target.value })
                }
              />
            </div>
            <SelectField
              label="Objective"
              value={campaign.objective}
              onChange={(e) =>
                setCampaign({ ...campaign, objective: e.target.value })
              }
              options={[
                "Awareness",
                "Traffic",
                "Leads",
                "Conversions",
                "Engagement",
              ].map((value) => ({ value, label: value }))}
            />
            <TextField
              label="Budget (ZMW)"
              type="number"
              min="0"
              step="1"
              value={campaign.budgetZmw}
              onChange={(e) =>
                setCampaign({ ...campaign, budgetZmw: e.target.value })
              }
            />
            <TextField
              label="Start date"
              type="date"
              required
              value={campaign.startDate}
              onChange={(e) =>
                setCampaign({ ...campaign, startDate: e.target.value })
              }
            />
            <TextField
              label="End date"
              type="date"
              required
              min={campaign.startDate || undefined}
              value={campaign.endDate}
              onChange={(e) =>
                setCampaign({ ...campaign, endDate: e.target.value })
              }
            />
            <div className="sm:col-span-2">
              <p className="text-sm font-medium text-slate-300">Channels</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {channels.filter((ch) => ch !== "Website").map((ch) => {
                  const on = campaign.channels.includes(ch);
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() =>
                        setCampaign({
                          ...campaign,
                          channels: on
                            ? campaign.channels.filter((x) => x !== ch)
                            : [...campaign.channels, ch],
                        })
                      }
                      className={`rounded-full border px-3 py-1.5 text-xs ${
                        on
                          ? "border-sky-400/40 bg-sky-400/10 text-sky-200"
                          : "border-slate-700 text-slate-400"
                      }`}
                    >
                      {ch}
                    </button>
                  );
                })}
              </div>
            </div>
          </form>
        </Modal>
      )}

      {metricsFor && (
        <Modal
          title={`Metrics · ${metricsFor.name}`}
          onClose={() => !busy && setMetricsFor(null)}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setMetricsFor(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="digital-metrics-form"
                disabled={busy}
              >
                {busy ? "Saving…" : "Save metrics"}
              </Button>
            </>
          }
        >
          <form
            id="digital-metrics-form"
            onSubmit={saveMetrics}
            className="grid gap-4 sm:grid-cols-2"
          >
            <TextField
              label="Impressions"
              type="number"
              min="0"
              step="1"
              value={metricsForm.impressions}
              onChange={(e) =>
                setMetricsForm({
                  ...metricsForm,
                  impressions: e.target.value,
                })
              }
            />
            <TextField
              label="Clicks"
              type="number"
              min="0"
              step="1"
              value={metricsForm.clicks}
              onChange={(e) =>
                setMetricsForm({ ...metricsForm, clicks: e.target.value })
              }
            />
            <TextField
              label="Leads"
              type="number"
              min="0"
              step="1"
              value={metricsForm.leads}
              onChange={(e) =>
                setMetricsForm({ ...metricsForm, leads: e.target.value })
              }
            />
            <TextField
              label="Conversions"
              type="number"
              min="0"
              step="1"
              value={metricsForm.conversions}
              onChange={(e) =>
                setMetricsForm({
                  ...metricsForm,
                  conversions: e.target.value,
                })
              }
            />
          </form>
        </Modal>
      )}

      {driveOpen && assetAccess && user && (
        <DrivePicker
          uid={user.uid}
          existingIds={
            new Set(assets.map((a) => a.driveFileId).filter(Boolean) as string[])
          }
          onAdded={() => void load()}
          onClose={() => setDriveOpen(false)}
        />
      )}

      {assetOpen && assetAccess && (
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
              <Button type="submit" form="digital-asset-form" disabled={busy}>
                {busy ? "Saving…" : "Add link"}
              </Button>
            </>
          }
        >
          <form
            id="digital-asset-form"
            onSubmit={submitAsset}
            className="grid gap-4"
          >
            <TextField
              label="Name"
              required
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
                options={["Image", "Video", "Document", "Template", "Other"].map(
                  (value) => ({ value, label: value }),
                )}
              />
              <TextField
                label="Platform"
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
              onChange={(e) =>
                setAsset({ ...asset, assetUrl: e.target.value })
              }
            />
            <TextAreaField
              label="Notes"
              rows={3}
              value={asset.notes}
              onChange={(e) => setAsset({ ...asset, notes: e.target.value })}
            />
          </form>
        </Modal>
      )}
      {closing && (
        <Modal
          title={
            closing.status === "completed"
              ? "Complete website request"
              : "Reject website request"
          }
          onClose={() => !busy && setClosing(null)}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setClosing(null)}
              >
                Cancel
              </Button>
              <Button
                variant={closing.status === "rejected" ? "danger" : "primary"}
                disabled={busy || !closeNote.trim()}
                onClick={() =>
                  void requestState(closing.item, closing.status, closeNote)
                }
              >
                {busy
                  ? "Saving…"
                  : closing.status === "completed"
                    ? "Mark completed"
                    : "Reject request"}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-slate-400">
            {closing.status === "completed"
              ? `Record what changed for “${closing.item.title}”, including a link to the live page if there is one. Never include passwords or keys.`
              : `Tell the requester why “${closing.item.title}” was rejected.`}
          </p>
          <TextAreaField
            label={closing.status === "completed" ? "Completion note" : "Reason"}
            rows={4}
            maxLength={2000}
            value={closeNote}
            onChange={(e) => setCloseNote(e.target.value)}
          />
        </Modal>
      )}
      {rejecting && (
        <Modal
          title="Reject content"
          onClose={() => !busy && setRejecting(null)}
          footer={
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setRejecting(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy || !rejectNote.trim()}
                onClick={() => void rejectPost(rejecting, rejectNote)}
              >
                {busy ? "Saving…" : "Reject"}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-slate-400">
            Tell the author what to change for “{rejecting.title}”. They will see this on the post.
          </p>
          <TextAreaField
            label="Feedback"
            rows={4}
            maxLength={1000}
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
          />
        </Modal>
      )}
    </section>
  );
}
