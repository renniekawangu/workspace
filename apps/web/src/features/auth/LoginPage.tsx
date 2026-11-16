import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { auth } from "../../lib/firebase";
export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate("/");
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      setMessage(
        code === "auth/user-disabled"
          ? "This account has been disabled. Contact an administrator."
          : code === "auth/too-many-requests"
            ? "Too many attempts. Wait a few minutes or reset your password."
            : "We could not sign you in. Check your details and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    if (!email) return setMessage("Enter your work email first.");
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage("If that account exists, a reset email has been sent.");
    } catch {
      setMessage("We could not send a reset email.");
    }
  }
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#070B12] p-5">
      <div className="absolute -left-24 top-0 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />

      <section className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/80 p-6 shadow-2xl shadow-slate-950/50 backdrop-blur sm:p-8">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />

        <div className="flex items-center justify-center">
          <div className="flex items-center gap-3 px-3 py-2 shadow-sm shadow-slate-950/50">
            <img
              src="/logo.png"
              alt="B34ST logo"
              className="h-10 w-24 object-contain"
            />
          </div>
        </div>

        <div className="mt-8">
          <p className="eyebrow">Secure sign in</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Welcome back
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Use your work account to access the B34ST operations workspace.
          </p>
        </div>

        <form className="mt-7 space-y-4" onSubmit={submit}>
          <label className="block text-sm text-slate-300">
            Work email
            <input
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
              type="email"
              autoComplete="email"
              placeholder="name@b34st.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="block text-sm text-slate-300">
            Password
            <input
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <button
            className="mt-2 w-full rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            type="submit"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-between gap-3 text-sm">
          <button
            className="font-medium text-cyan-300 transition hover:text-cyan-200"
            type="button"
            onClick={reset}
          >
            Reset password
          </button>
          <span className="text-slate-500">Secure access</span>
        </div>

        {message && (
          <p
            role="status"
            className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100"
          >
            {message}
          </p>
        )}
      </section>
    </main>
  );
}
