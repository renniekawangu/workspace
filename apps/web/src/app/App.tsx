import { signOut } from "firebase/auth";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { auth } from "../lib/firebase";
import { AuditLogPage } from "../features/audit/AuditLogPage";
import { AnnouncementsPage } from "../features/announcements/AnnouncementsPage";
import { AdminPage } from "../features/admin/AdminPage";
import { LoginPage } from "../features/auth/LoginPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { DirectoryPage } from "../features/directory/DirectoryPage";
import { StaffProfilePage } from "../features/directory/StaffProfilePage";
import { OnboardingPage } from "../features/onboarding/OnboardingPage";
import { TaskBoardPage } from "../features/tasks/TaskBoardPage";
import { AttendancePage } from "../features/attendance/AttendancePage";
import { LeavePage } from "../features/leave/LeavePage";
import { LeadsPage } from "../features/business/LeadsPage";
import { ClientsPage } from "../features/business/ClientsPage";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { FinancePage } from "../features/finance/FinancePage";
import { DigitalOperationsPage } from "../features/digital/DigitalOperationsPage";
import { ReportsPage } from "../features/reports/ReportsPage";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
import { AuthProvider, useAuth } from "./AuthProvider";
import { RequireRole } from "./RequireRole";
import {
  canAccessDirectory,
  canAccessFinance,
  isBusinessRole,
  isReportsRole,
} from "../lib/roles";
import { Icon } from "../lib/ui";

type IconName = "home" | "tasks" | "bell" | "log" | "plus" | "search" | "users" | "shield" | "check" | "calendar" | "megaphone";

const navItems: Array<{ to: string; label: string; icon: IconName; end?: boolean; business?: boolean; reports?: boolean }> = [
  { to: "/", label: "Overview", icon: "home", end: true },
  { to: "/tasks", label: "Tasks & work", icon: "tasks" },
  { to: "/notifications", label: "Notifications", icon: "bell" },
  { to: "/digital", label: "Digital operations", icon: "log" },
  { to: "/projects", label: "Projects", icon: "plus" },
  { to: "/business/leads", label: "Lead pipeline", icon: "search", business: true },
  { to: "/business/clients", label: "Clients", icon: "users", business: true },
  { to: "/finance", label: "Finance", icon: "shield", business: true },
  { to: "/reports", label: "Reports & analytics", icon: "check", reports: true },
  { to: "/directory", label: "People directory", icon: "users" },
  { to: "/attendance", label: "Attendance", icon: "calendar" },
  { to: "/leave", label: "Leave management", icon: "calendar" },
  { to: "/onboarding", label: "Onboarding", icon: "check" },
  { to: "/announcements", label: "Announcements", icon: "megaphone" },
];

function AppShell({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const canBusiness = isBusinessRole(role);
  const canReports = isReportsRole(role);
  const canDirectory = canAccessDirectory(role);
  const canFinance = canAccessFinance(role);
  const handleSignOut = () => void signOut(auth);

  return (
    <div className="min-h-screen bg-[#070B12] text-slate-100">
      <aside className="sidebar fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-slate-800/80 bg-[#090E17] lg:flex">
        <Link to="/" className="flex h-[76px] items-center gap-3 border-b border-slate-800/80 px-6">
          <img src="/logo.png" alt="B34ST logo" className="h-16 w-24 flex-none object-contain" />
          <span className="block text-sm font-bold tracking-[0.16em] text-white"></span>
        </Link>
        <div className="px-4 pt-7"><p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">Workspace</p><nav className="mt-3 space-y-1">{navItems.filter((item) => (!("business" in item) || canBusiness) && (!("reports" in item) || canReports) && !(item.to === "/directory" && !canDirectory) && !(item.to === "/finance" && !canFinance)).map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `side-link ${isActive ? "side-link-active" : ""}`}><span className="flex w-6 items-center justify-center text-base"><Icon name={item.icon} size={15} /></span><span>{item.label}</span></NavLink>)}</nav></div>
        {role === "admin" && <div className="px-4 pt-8"><p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">Administration</p><nav className="mt-3 space-y-1"><NavLink to="/admin/access" className={({ isActive }) => `side-link ${isActive ? "side-link-active" : ""}`}><span className="flex w-6 items-center justify-center"><Icon name="users" size={15} /></span><span>Staff access</span></NavLink><NavLink to="/admin/audit" className={({ isActive }) => `side-link ${isActive ? "side-link-active" : ""}`}><span className="flex w-6 items-center justify-center"><Icon name="log" size={15} /></span><span>Audit history</span></NavLink></nav></div>}
        <div className="mt-auto border-t border-slate-800/80 p-4"><div className="flex items-center gap-3 rounded-xl bg-slate-900/70 p-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-sky-400/15 text-sm font-semibold text-sky-300">{(user?.displayName || user?.email || "B").charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{user?.displayName || user?.email}</p><p className="mt-0.5 text-[10px] capitalize text-slate-500">{role || "signed out"} account</p></div></div><button className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-left text-xs font-medium text-slate-200 transition hover:border-sky-400 hover:text-white" onClick={handleSignOut}>↗ &nbsp; Sign out</button></div>
      </aside>
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-[#070B12]/90 backdrop-blur-xl"><div className="flex h-[76px] items-center justify-between px-5 sm:px-8"><div className="flex items-center gap-3 lg:hidden"><img src="/logo.png" alt="B34ST logo" className="h-12 w-12 flex-none object-contain" /><span className="text-sm font-bold tracking-widest">B34ST</span></div><div className="hidden lg:block"><p className="text-xs text-slate-500">B34ST Web Services <span className="px-1.5 text-slate-700">/</span> <span className="text-slate-300">Staff workspace</span></p></div><div className="flex items-center gap-3"><span className="hidden rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-medium text-emerald-300 sm:inline-flex"><span className="mr-2 h-1.5 w-1.5 self-center rounded-full bg-emerald-400" />Workspace active</span><div className="grid h-9 w-9 place-items-center rounded-full border border-slate-700 bg-slate-900 text-xs font-semibold text-sky-200">{(user?.displayName || user?.email || "B").charAt(0).toUpperCase()}</div><button className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-sky-400 hover:text-white" onClick={handleSignOut}>Sign out</button></div></div><nav className="flex gap-1 overflow-x-auto border-t border-slate-800/70 px-4 py-2 lg:hidden">{navItems.filter((item) => (!("business" in item) || canBusiness) && (!("reports" in item) || canReports) && !(item.to === "/directory" && !canDirectory) && !(item.to === "/finance" && !canFinance)).map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `mobile-nav-link ${isActive ? "mobile-nav-link-active" : ""}`}><span className="mr-2 inline-flex items-center"><Icon name={item.icon} size={14} /></span>{item.label}</NavLink>)}</nav></header>
        <main className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 sm:py-9">{children}</main>
      </div>
    </div>
  );
}
function AccessDenied() {
  const { user, role, active, loading } = useAuth();
  if (loading) return <p className="p-6 text-slate-400">Loading your account…</p>;
  if (!user) return <Navigate to="/login" replace />;
  const inactive = !active || !role;
  return (
    <main className="grid min-h-screen place-items-center bg-[#070B12] p-5 text-slate-100">
      <div className="panel w-full max-w-md p-8">
        <h1 className="text-xl font-bold">Access denied</h1>
        <p className="mt-2 text-sm text-slate-400">
          {inactive
            ? "Your account is inactive or has no role assigned. Ask an administrator to restore your access."
            : "Your role does not have permission to open that page."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {!inactive && <Link to="/" className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:border-sky-400">Back to overview</Link>}
          <button className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:border-sky-400" onClick={() => void signOut(auth)}>Sign out</button>
        </div>
      </div>
    </main>
  );
}
function Shell({ children }: { children: ReactNode }) { return <AppShell>{children}</AppShell>; }
function Home() { return <Shell><DashboardPage /></Shell>; }
export function App() {
  return <BrowserRouter><AuthProvider><Routes><Route path="/login" element={<LoginPage />} /><Route path="/access-denied" element={<AccessDenied />} /><Route element={<RequireRole allowed={["admin", "bizops", "digitalops", "designer", "employee"]} />}><Route path="/" element={<Home />} /><Route path="/tasks" element={<Shell><TaskBoardPage /></Shell>} /><Route path="/digital" element={<Shell><DigitalOperationsPage /></Shell>} /><Route path="/notifications" element={<Shell><NotificationsPage /></Shell>} /><Route path="/projects" element={<Shell><ProjectsPage /></Shell>} /><Route path="/attendance" element={<Shell><AttendancePage /></Shell>} /><Route path="/leave" element={<Shell><LeavePage /></Shell>} /><Route path="/onboarding" element={<Shell><OnboardingPage /></Shell>} /><Route path="/announcements" element={<Shell><AnnouncementsPage /></Shell>} /><Route element={<RequireRole allowed={["admin", "bizops", "digitalops"]} />}><Route path="/reports" element={<Shell><ReportsPage /></Shell>} /></Route><Route element={<RequireRole allowed={["admin", "bizops"]} />}><Route path="/business/leads" element={<Shell><LeadsPage /></Shell>} /><Route path="/business/clients" element={<Shell><ClientsPage /></Shell>} /></Route><Route element={<RequireRole allowed={["admin"]} />}><Route path="/finance" element={<Shell><FinancePage /></Shell>} /></Route><Route element={<RequireRole allowed={["admin", "employee"]} />}><Route path="/directory" element={<Shell><DirectoryPage /></Shell>} /><Route path="/directory/:uid" element={<Shell><StaffProfilePage /></Shell>} /></Route></Route><Route element={<RequireRole allowed={["admin"]} />}><Route path="/admin/access" element={<Shell><AdminPage /></Shell>} /><Route path="/admin/audit" element={<Shell><AuditLogPage /></Shell>} /></Route><Route path="*" element={<Navigate to="/" replace />} /></Routes></AuthProvider></BrowserRouter>;
}
