import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import { useAuth } from "../../app/AuthProvider";
import { writeAudit } from "../../lib/audit";
import { db } from "../../lib/firebase";
import { useToast } from "../../lib/toast";
import { Button, EmptyState, ErrorNote, LoadingState, Modal, StatusPill, TextAreaField, TextField, type Tone } from "../../lib/ui";

const PAGE_OPTIONS = ["Home", "About", "Products / Collection", "Services", "Contact"];
const STYLE_OPTIONS = ["Elegant", "Bold", "Friendly", "Modern", "Traditional", "Minimal"];
const PHOTO_OPTIONS = ["I have product photos", "I have a logo", "Use stand-in photos for now"];

type Product = { name: string; category: string; desc: string; price: string; photo: string };
type Service = { name: string; desc: string };
type Brief = {
  id: string; businessName: string; tagline: string; description: string; location: string; whatsapp: string;
  email: string; phone: string; social: string; pages: string[]; otherPages: string; categories: string;
  products: Product[]; services: Service[]; steps: string; about: string; facts: string; brandColors: string;
  styles: string[]; likedSites: string; photosAndLogo: string[]; domain: string; deadline: string; avoid: string;
  status: string; assignedTo: string; internalNote: string; createdBy: string;
};

const blankBrief = {
  businessName: "", tagline: "", description: "", location: "", whatsapp: "", email: "", phone: "", social: "",
  pages: [...PAGE_OPTIONS], otherPages: "", categories: "",
  products: [{ name: "", category: "", desc: "", price: "", photo: "" }] as Product[],
  services: [{ name: "", desc: "" }] as Service[], steps: "", about: "", facts: "", brandColors: "",
  styles: [] as string[], likedSites: "", photosAndLogo: [] as string[], domain: "", deadline: "", avoid: "",
};

function tone(status: string): Tone {
  if (status === "completed") return "green";
  if (status === "triaged" || status === "in_progress") return "blue";
  if (status === "rejected") return "red";
  return "amber";
}

function briefSummary(b: Brief) {
  const line = (k: string, v?: string) => `- ${k}: ${v?.trim() || "(not provided)"}`;
  const out = ["# Company intake", "", "## 1. Business basics", line("Business name", b.businessName), line("Tagline", b.tagline), line("What we sell or do", b.description), line("Location", b.location), line("WhatsApp", b.whatsapp), line("Email", b.email), line("Phone", b.phone), line("Social media", b.social), "", "## 2. Pages", line("Pages wanted", b.pages.join(", ")), line("Other pages", b.otherPages), "", "## 3. Products", line("Categories", b.categories)];
  b.products.forEach((p) => out.push(`- Product: ${p.name || "(unnamed)"} | category: ${p.category || "-"} | description: ${p.desc || "-"} | price: ${p.price || "on enquiry"} | photo: ${p.photo || "-"}`));
  out.push("", "## 4. Services");
  b.services.forEach((s) => out.push(`- Service: ${s.name || "(unnamed)"} | ${s.desc || "-"}`));
  out.push(line("How customers get started", b.steps), "", "## 5. About", line("Introduction", b.about), line("Facts to show (only if real)", b.facts), "", "## 6. Look and feel", line("Brand colours", b.brandColors), line("Style", b.styles.join(", ")), line("Websites liked", b.likedSites), line("Photos and logo", b.photosAndLogo.join(", ")), "", "## 7. Practical", line("Domain", b.domain), line("Deadline", b.deadline), line("Must NOT say or show", b.avoid));
  return out.join("\n");
}

export function WebsiteBriefsTab() {
  const { user } = useAuth();
  const toast = useToast();
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [search, setSearch] = useState(""); const [filter, setFilter] = useState("open");
  const [formOpen, setFormOpen] = useState(false); const [selected, setSelected] = useState<Brief | null>(null);
  const [form, setForm] = useState(blankBrief);
  const [workflow, setWorkflow] = useState<Brief | null>(null); const [workflowStatus, setWorkflowStatus] = useState("triaged"); const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const snap = await getDocs(collection(db, "websiteBriefs")); setBriefs(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Brief)); }
    catch { setError("Unable to load website briefs. Check your role and Firestore rules."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => briefs.filter((b) => {
    const statusMatch = filter === "all" ? true : filter === "open" ? !["completed", "rejected"].includes(b.status) : b.status === filter;
    const haystack = `${b.businessName} ${b.location} ${b.description} ${b.email} ${b.whatsapp}`.toLowerCase();
    return statusMatch && haystack.includes(search.toLowerCase());
  }), [briefs, filter, search]);

  function toggle(list: string[], value: string) { return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]; }

  async function submit(e: FormEvent) {
    e.preventDefault(); if (!user) return;
    if (!form.businessName.trim() || !form.description.trim() || !form.location.trim()) { setError("Enter the business name, what the business does, and its location."); return; }
    if (!form.whatsapp.trim() && !form.email.trim()) { setError("Add a WhatsApp number or an email address."); return; }
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) { setError("Enter a valid email address."); return; }
    setBusy(true); setError("");
    try {
      const cleanProducts = form.products.map((p) => ({ name: p.name.trim(), category: p.category.trim(), desc: p.desc.trim(), price: p.price.trim(), photo: p.photo.trim() })).filter((p) => Object.values(p).some(Boolean));
      const cleanServices = form.services.map((s) => ({ name: s.name.trim(), desc: s.desc.trim() })).filter((s) => Object.values(s).some(Boolean));
      const ref = await addDoc(collection(db, "websiteBriefs"), {
        ...form, businessName: form.businessName.trim(), tagline: form.tagline.trim(), description: form.description.trim(), location: form.location.trim(), whatsapp: form.whatsapp.trim(), email: form.email.trim(), phone: form.phone.trim(), social: form.social.trim(), otherPages: form.otherPages.trim(), categories: form.categories.trim(), products: cleanProducts, services: cleanServices, steps: form.steps.trim(), about: form.about.trim(), facts: form.facts.trim(), brandColors: form.brandColors.trim(), likedSites: form.likedSites.trim(), domain: form.domain.trim(), deadline: form.deadline.trim(), avoid: form.avoid.trim(),
        status: "submitted", assignedTo: "", internalNote: "", createdBy: user.uid, updatedBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      await writeAudit(user.uid, "digital.website_brief_created", "websiteBrief", ref.id);
      setForm(blankBrief); setFormOpen(false); await load(); toast("Website brief created.", "success");
    } catch { setError("Save failed. Check permissions and required fields."); }
    finally { setBusy(false); }
  }

  async function changeStatus() {
    if (!user || !workflow) return;
    if (["completed", "rejected"].includes(workflowStatus) && !note.trim()) { setError("Add an internal note before completing or rejecting this brief."); return; }
    setBusy(true); setError("");
    try {
      await updateDoc(doc(db, "websiteBriefs", workflow.id), { status: workflowStatus, internalNote: note.trim(), updatedBy: user.uid, updatedAt: serverTimestamp() });
      await writeAudit(user.uid, `digital.website_brief_${workflowStatus}`, "websiteBrief", workflow.id);
      setWorkflow(null); setNote(""); await load(); toast("Brief status updated.", "success");
    } catch { setError("Unable to update brief status."); } finally { setBusy(false); }
  }

  async function copySummary(b: Brief) {
    try { await navigator.clipboard.writeText(briefSummary(b)); toast("Brief summary copied.", "success"); }
    catch { setError("Clipboard access is unavailable. You can download the summary instead."); }
  }
  function downloadSummary(b: Brief) {
    const url = URL.createObjectURL(new Blob([briefSummary(b)], { type: "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = `${b.businessName || "company"}-website-details.txt`.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase(); a.click(); URL.revokeObjectURL(url);
  }

  return <div className="space-y-4">
    {error && <ErrorNote>{error}</ErrorNote>}
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="Search briefs" placeholder="Business, location or contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex flex-wrap gap-2 pb-1">
          {[["open", "Open"], ["submitted", "Submitted"], ["triaged", "Triaged"], ["in_progress", "In progress"], ["completed", "Completed"], ["rejected", "Rejected"], ["all", "All"]].map(([key, label]) => <button key={key} type="button" onClick={() => setFilter(key)} className={`inline-flex min-h-10 items-center rounded-full border px-3 text-xs font-medium ${filter === key ? "border-sky-400/40 bg-sky-400/10 text-sky-200" : "border-slate-700 text-slate-400"}`}>{label}</button>)}
        </div>
      </div>
      <Button onClick={() => { setForm(blankBrief); setFormOpen(true); }}>New website brief</Button>
    </div>
    {loading ? <LoadingState /> : visible.length === 0 ? <EmptyState title="No website briefs" text="Nothing matches this view. Create a structured brief for a customer website." /> : <div className="grid gap-3 md:grid-cols-2">
      {visible.map((b) => <article key={b.id} className="panel p-4">
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-white">{b.businessName}</h3><p className="mt-1 text-xs text-slate-500">{b.location || "Location not provided"}</p></div><StatusPill tone={tone(b.status)}>{b.status.replaceAll("_", " ")}</StatusPill></div>
        <p className="mt-3 line-clamp-3 text-sm text-slate-300">{b.description}</p><p className="mt-3 text-xs text-slate-500">{b.whatsapp || b.email || "No contact provided"}</p>
        {b.internalNote && <p className="mt-2 rounded-lg border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-300">Note: {b.internalNote}</p>}
        <div className="mt-4 flex flex-wrap gap-2"><Button variant="subtle" onClick={() => setSelected(b)}>View brief</Button>{["triaged", "in_progress", "completed", "rejected"].map((status) => <Button key={status} variant="subtle" disabled={b.status === status} onClick={() => { setWorkflow(b); setWorkflowStatus(status); setNote(b.internalNote || ""); }}>{status.replaceAll("_", " ")}</Button>)}</div>
      </article>)}
    </div>}

    {formOpen && <Modal title="New website brief" size="lg" onClose={() => !busy && setFormOpen(false)} footer={<><Button variant="ghost" disabled={busy} onClick={() => setFormOpen(false)}>Cancel</Button><Button type="submit" form="website-brief-form" disabled={busy}>{busy ? "Saving…" : "Create brief"}</Button></>}>
      <form id="website-brief-form" onSubmit={submit} className="space-y-5">
        <fieldset className="space-y-3"><legend className="text-sm font-semibold text-slate-200">1. Business basics</legend>
          <div className="grid gap-3 sm:grid-cols-2"><TextField label="Business name" required value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} /><TextField label="Short tagline" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} /></div>
          <TextAreaField label="What do you sell or do?" required rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2"><TextField label="Location (city, country)" required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /><TextField label="WhatsApp number" type="tel" placeholder="+260 …" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /><TextField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /><TextField label="Phone (if different)" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <TextAreaField label="Social media links" rows={2} value={form.social} onChange={(e) => setForm({ ...form, social: e.target.value })} />
        </fieldset>
        <fieldset className="space-y-3"><legend className="text-sm font-semibold text-slate-200">2. Pages you want</legend><div className="flex flex-wrap gap-2">{PAGE_OPTIONS.map((p) => <label key={p} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-700 px-3 text-xs text-slate-300"><input type="checkbox" checked={form.pages.includes(p)} onChange={() => setForm({ ...form, pages: toggle(form.pages, p) })} />{p}</label>)}</div><TextField label="Anything else?" hint="Gallery, FAQ, team, other locations" value={form.otherPages} onChange={(e) => setForm({ ...form, otherPages: e.target.value })} /></fieldset>
        <fieldset className="space-y-3"><legend className="text-sm font-semibold text-slate-200">3. Products or catalogue</legend><TextField label="Categories" hint="Separate with commas" value={form.categories} onChange={(e) => setForm({ ...form, categories: e.target.value })} />
          {form.products.map((p, i) => <div key={i} className="grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-2"><TextField label="Product name" value={p.name} onChange={(e) => setForm({ ...form, products: form.products.map((v, n) => n === i ? { ...v, name: e.target.value } : v) })} /><TextField label="Category" value={p.category} onChange={(e) => setForm({ ...form, products: form.products.map((v, n) => n === i ? { ...v, category: e.target.value } : v) })} /><TextField label="Short description" value={p.desc} onChange={(e) => setForm({ ...form, products: form.products.map((v, n) => n === i ? { ...v, desc: e.target.value } : v) })} /><TextField label="Price (optional)" value={p.price} onChange={(e) => setForm({ ...form, products: form.products.map((v, n) => n === i ? { ...v, price: e.target.value } : v) })} /><TextField label="Photo file name" value={p.photo} onChange={(e) => setForm({ ...form, products: form.products.map((v, n) => n === i ? { ...v, photo: e.target.value } : v) })} /><Button variant="ghost" onClick={() => setForm({ ...form, products: form.products.filter((_, n) => n !== i) })}>Remove product</Button></div>)}
          <Button variant="ghost" onClick={() => setForm({ ...form, products: [...form.products, { name: "", category: "", desc: "", price: "", photo: "" }] })}>+ Add product</Button>
        </fieldset>
        <fieldset className="space-y-3"><legend className="text-sm font-semibold text-slate-200">4. Services</legend>{form.services.map((s, i) => <div key={i} className="grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-2"><TextField label="Service name" value={s.name} onChange={(e) => setForm({ ...form, services: form.services.map((v, n) => n === i ? { ...v, name: e.target.value } : v) })} /><TextField label="Description" value={s.desc} onChange={(e) => setForm({ ...form, services: form.services.map((v, n) => n === i ? { ...v, desc: e.target.value } : v) })} /><Button variant="ghost" onClick={() => setForm({ ...form, services: form.services.filter((_, n) => n !== i) })}>Remove service</Button></div>)}<Button variant="ghost" onClick={() => setForm({ ...form, services: [...form.services, { name: "", desc: "" }] })}>+ Add service</Button><TextAreaField label="How do customers order or get started?" rows={3} value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} /></fieldset>
        <fieldset className="space-y-3"><legend className="text-sm font-semibold text-slate-200">5. About your business</legend><TextAreaField label="Short introduction" hint="2 to 4 true sentences" rows={3} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} /><TextAreaField label="Year started, team size, awards or certifications" rows={2} value={form.facts} onChange={(e) => setForm({ ...form, facts: e.target.value })} /></fieldset>
        <fieldset className="space-y-3"><legend className="text-sm font-semibold text-slate-200">6. Look and feel</legend><TextField label="Brand colours" hint="Names or hex codes, or choose for me" value={form.brandColors} onChange={(e) => setForm({ ...form, brandColors: e.target.value })} /><div><p className="text-xs font-medium text-slate-300">Style</p><div className="mt-2 flex flex-wrap gap-2">{STYLE_OPTIONS.map((p) => <label key={p} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-700 px-3 text-xs text-slate-300"><input type="checkbox" checked={form.styles.includes(p)} onChange={() => setForm({ ...form, styles: toggle(form.styles, p) })} />{p}</label>)}</div></div><TextAreaField label="Websites you like" rows={2} value={form.likedSites} onChange={(e) => setForm({ ...form, likedSites: e.target.value })} /><div><p className="text-xs font-medium text-slate-300">Photos and logo</p><div className="mt-2 flex flex-wrap gap-2">{PHOTO_OPTIONS.map((p) => <label key={p} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-700 px-3 text-xs text-slate-300"><input type="checkbox" checked={form.photosAndLogo.includes(p)} onChange={() => setForm({ ...form, photosAndLogo: toggle(form.photosAndLogo, p) })} />{p}</label>)}</div></div></fieldset>
        <fieldset className="space-y-3"><legend className="text-sm font-semibold text-slate-200">7. Practical</legend><div className="grid gap-3 sm:grid-cols-2"><TextField label="Domain name" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} /><TextField label="Deadline" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></div><TextAreaField label="Anything we must NOT say or show?" rows={2} value={form.avoid} onChange={(e) => setForm({ ...form, avoid: e.target.value })} /></fieldset>
      </form>
    </Modal>}

    {selected && <Modal title={selected.businessName} size="lg" onClose={() => setSelected(null)} footer={<><Button variant="ghost" onClick={() => downloadSummary(selected)}>Download summary</Button><Button onClick={() => void copySummary(selected)}>Copy summary</Button></>}><pre className="max-h-[60vh] whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs leading-6 text-slate-300">{briefSummary(selected)}</pre></Modal>}
    {workflow && <Modal title={`Update ${workflow.businessName}`} onClose={() => !busy && setWorkflow(null)} footer={<><Button variant="ghost" disabled={busy} onClick={() => setWorkflow(null)}>Cancel</Button><Button variant={workflowStatus === "rejected" ? "danger" : "primary"} disabled={busy} onClick={() => void changeStatus()}>{busy ? "Saving…" : "Update status"}</Button></>}><div className="space-y-3"><SelectStatus value={workflowStatus} onChange={setWorkflowStatus} /><TextAreaField label="Internal note" required={["completed", "rejected"].includes(workflowStatus)} rows={4} value={note} onChange={(e) => setNote(e.target.value)} /></div></Modal>}
  </div>;
}

function SelectStatus({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm font-medium text-slate-300">Status<select className="mt-1 w-full rounded-lg border border-slate-700 bg-[#080C12] px-3 py-2.5 text-sm text-slate-100" value={value} onChange={(e) => onChange(e.target.value)}>{["triaged", "in_progress", "completed", "rejected"].map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></label>;
}
