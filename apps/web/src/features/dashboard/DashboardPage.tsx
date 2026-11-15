import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { loadTasks } from "../../lib/data";
import { db } from "../../lib/firebase";
import {
  canAccessDirectory,
  isReportsRole,
} from "../../lib/roles";

type Task = { id: string; title: string; status: "todo" | "in_progress" | "done"; department?: string };
type Announcement = { id: string; title: string; body: string; createdAt?: { toDate?: () => Date } };

function Metric({ label, value, detail, tone = "blue" }: { label: string; value: string | number; detail: string; tone?: "blue" | "green" | "amber" }) {
  const tones = { blue: "bg-sky-400", green: "bg-emerald-400", amber: "bg-amber-400" };
  return (
    <article className="metric-card">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-400">{label}</p>
        <span className={`h-2 w-2 rounded-full ${tones[tone]}`} />
      </div>
      <p className="mt-5 text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

export function DashboardPage() {
  const { user, role } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!user || !role) return;
    const currentUser = user;
    const currentRole = role;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const [taskList, announcementResult] = await Promise.all([
          loadTasks({ uid: currentUser.uid, role: currentRole }, true),
          getDocs(query(collection(db, "announcements"), where("status", "==", "published"), limit(5))),
        ]);
        if (cancelled) return;
        setTasks(taskList);
        setAnnouncements(announcementResult.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<Announcement, "id">) })));
      } catch {
        if (!cancelled) setLoadError("Some workspace data could not be loaded. Check your connection or access permissions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [user, role]);

  const counts = useMemo(() => ({
    total: tasks.length,
    todo: tasks.filter((task) => task.status === "todo").length,
    progress: tasks.filter((task) => task.status === "in_progress").length,
    done: tasks.filter((task) => task.status === "done").length,
  }), [tasks]);
  const completion = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
  const firstName = user?.displayName?.split(" ")[0] || user?.email?.split("@")[0] || "there";
  const canDirectory = canAccessDirectory(role);

  const quickLinks = [
    { to: "/tasks", icon: "↗", title: "Open task board", text: "Review assignments and update progress" },
    { to: "/notifications", icon: "♢", title: "Attention centre", text: "Review approvals, overdue items and reminders" },
    ...(canDirectory ? [{ to: "/directory", icon: "◎", title: "Find a teammate", text: "Browse staff profiles and departments" }] : []),
    { to: "/onboarding", icon: "✓", title: "Onboarding", text: "Review onboarding progress and checklists" },
    { to: "/announcements", icon: "✳", title: "Announcements", text: "Read the latest team updates" },
    ...(isReportsRole(role) ? [{ to: "/reports", icon: "▥", title: "Reports & analytics", text: "Review performance across accessible modules" }] : []),
  ];

  return (
    <section className="space-y-8">
      <div className="dashboard-hero">
        <div className="relative z-10 max-w-2xl">
          <p className="eyebrow">B34ST · OPERATIONS OVERVIEW</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Good to see you, {firstName}.</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">Your workspace at a glance. Keep your priorities moving, stay connected with the team, and make progress visible.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/tasks" className="primary-action">View my tasks <span aria-hidden="true">→</span></Link>
            {canDirectory && <Link to="/directory" className="secondary-action">Explore the team</Link>}
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true"><div className="hero-orbit-inner">B</div></div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="eyebrow">YOUR WORKSPACE</p><h2 className="section-title mt-1">At a glance</h2></div>
        <p className="text-xs text-slate-500">{loading ? "Updating workspace…" : `Showing ${counts.total} accessible tasks`}</p>
      </div>
      {loadError && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{loadError}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total tasks" value={loading ? "—" : counts.total} detail="Tasks visible to your role" />
        <Metric label="To do" value={loading ? "—" : counts.todo} detail="Waiting to be started" tone="amber" />
        <Metric label="In progress" value={loading ? "—" : counts.progress} detail="Currently being worked on" />
        <Metric label="Completed" value={loading ? "—" : counts.done} detail={`${completion}% of visible tasks complete`} tone="green" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
        <section className="panel p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div><p className="eyebrow">WORKLOAD</p><h2 className="section-title mt-1">Task progress</h2></div>
            <Link to="/tasks" className="text-sm font-medium text-sky-300 hover:text-white">Open board →</Link>
          </div>
          <div className="mt-7 flex items-end justify-between gap-4">
            <div><p className="text-4xl font-semibold text-white">{loading ? "—" : `${completion}%`}</p><p className="mt-1 text-sm text-slate-500">Completion rate</p></div>
            <p className="text-right text-xs text-slate-500">{counts.done} of {counts.total} tasks completed</p>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-300 transition-all" style={{ width: `${completion}%` }} /></div>
          <div className="mt-5 grid grid-cols-3 gap-3">
            {[{ label: "To do", value: counts.todo, color: "bg-amber-400" }, { label: "In progress", value: counts.progress, color: "bg-sky-400" }, { label: "Done", value: counts.done, color: "bg-emerald-400" }].map((item) => <div key={item.label} className="rounded-xl bg-slate-900/70 p-3"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${item.color}`} /><span className="text-xs text-slate-400">{item.label}</span></div><p className="mt-2 text-xl font-semibold text-white">{loading ? "—" : item.value}</p></div>)}
          </div>
        </section>
        <section className="panel p-5 sm:p-6">
          <p className="eyebrow">QUICK ACCESS</p><h2 className="section-title mt-1">Get things done</h2>
          <div className="mt-4 divide-y divide-slate-800/80">
            {quickLinks.map((item) => <Link to={item.to} key={item.to} className="group flex items-center gap-3 py-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-700 bg-slate-900 text-lg text-sky-300">{item.icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-100 group-hover:text-sky-300">{item.title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{item.text}</span></span><span className="text-slate-600 transition group-hover:translate-x-1 group-hover:text-sky-300">→</span></Link>)}
          </div>
        </section>
      </div>

      <section className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">TEAM SIGNAL</p><h2 className="section-title mt-1">Latest announcements</h2></div><span className="text-xs text-slate-500">Published updates</span></div>
        {loading ? <p className="mt-5 text-sm text-slate-500">Loading announcements…</p> : announcements.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{announcements.map((item) => <article key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><h3 className="font-medium text-white">{item.title}</h3><p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-400">{item.body}</p></article>)}</div> : <p className="mt-5 rounded-xl border border-dashed border-slate-800 p-5 text-sm text-slate-500">There are no published announcements yet.</p>}
      </section>
    </section>
  );
}
