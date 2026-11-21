// Set these so the Email and WhatsApp buttons go to you. Leave blank to hide them.
// submitUrl: where "Send to B34ST" posts. Same-origin by default. If this page is hosted on another
// site, use the full URL of the staff app and add this site to INTAKE_ALLOWED_ORIGINS there. Set "" to hide the button.
const CONFIG = { owner: "B34ST Web Services", email: "renniekawangu@gmail.com", whatsapp: "260770817839", submitUrl: "/api/intake-submit" };
const startedAt = Date.now();

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const v = (id) => $("#" + id).value.trim();
const chips = (id, items, checked = []) => { $("#" + id).innerHTML = items.map((t) => `<label class="chip"><input type="checkbox" value="${t}" ${checked.includes(t) ? "checked" : ""}>${t}</label>`).join(""); };
const picked = (id) => $$("input:checked", $("#" + id)).map((i) => i.value);
chips("pages", ["Home", "About", "Products / Collection", "Services", "Contact"], ["Home", "About", "Products / Collection", "Services", "Contact"]);
chips("styles", ["Elegant", "Bold", "Friendly", "Modern", "Traditional", "Minimal"]);
chips("photos", ["I have product photos", "I have a logo", "Use stand-in photos for now"]);

const tpl = {
  products: `<input type="text" data-f="name" aria-label="Product name" placeholder="Product name"><input type="text" data-f="category" aria-label="Category" placeholder="Category"><input type="text" data-f="desc" aria-label="Short description" placeholder="Short description"><input type="text" data-f="price" aria-label="Price (optional)" placeholder="Price (optional)"><input type="text" data-f="photo" aria-label="Photo file name" placeholder="Photo file name (optional)">`,
  services: `<input type="text" data-f="name" aria-label="Service name" placeholder="Service name"><input type="text" data-f="desc" aria-label="Short description" placeholder="One-line description">`,
};
function addRow(id, focus = true) {
  const d = document.createElement("div"); d.className = "row" + (id === "products" ? " p" : "");
  d.innerHTML = tpl[id] + '<button type="button" class="rm" aria-label="Remove this row">×</button>';
  $(".rm", d).onclick = () => d.remove(); $("#" + id).append(d); if (focus) $("input", d).focus();
}
const rows = (id) => $$(".row", $("#" + id)).map((r) => Object.fromEntries($$("[data-f]", r).map((i) => [i.dataset.f, i.value.trim()]))).filter((o) => Object.values(o).some(Boolean));
$("#addp").onclick = () => addRow("products"); $("#adds").onclick = () => addRow("services");
addRow("products", false); addRow("services", false);

const contact = () => { const ok = v("wa") || v("email") || v("phone"); $("#wa").setCustomValidity(ok ? "" : "Add a WhatsApp number, phone or email"); $("#cerr").hidden = !!ok || !$("#cerr").dataset.show; };
["wa", "email", "phone"].forEach((i) => $("#" + i).addEventListener("input", contact));

const one = (s) => String(s || "").replace(/\s*[\r\n]+\s*/g, " / ").trim();
const cell = (s) => one(s).replace(/\|/g, "/");
const line = (k, val) => `- ${k}: ${one(val) || "(not provided)"}`;
function build() {
  const o = [];
  o.push("# Company intake", "", "## 1. Business basics", line("Business name", v("name")), line("Contact person", v("contact")), line("Tagline", v("tag")), line("What we sell or do", v("what")), line("Location", v("loc")), line("WhatsApp", v("wa")), line("Email", v("email")), line("Phone", v("phone")), line("Social media", v("social")));
  o.push("", "## 2. Pages", line("Pages wanted", picked("pages").join(", ")), line("Other pages", v("otherpages")));
  o.push("", "## 3. Products", line("Categories", v("cats")));
  rows("products").forEach((p) => o.push(`- Product: ${cell(p.name) || "(unnamed)"} | category: ${cell(p.category) || "-"} | description: ${cell(p.desc) || "-"} | price: ${cell(p.price) || "on enquiry"} | photo: ${cell(p.photo) || "-"}`));
  o.push("", "## 4. Services");
  rows("services").forEach((s) => o.push(`- Service: ${cell(s.name) || "(unnamed)"} | ${cell(s.desc) || "-"}`));
  o.push(line("How customers get started", v("steps")));
  o.push("", "## 5. About", line("Introduction", v("about")), line("Facts to show (only if real)", v("facts")));
  o.push("", "## 6. Look and feel", line("Brand colours", v("colors")), line("Style", picked("styles").join(", ")), line("Websites liked", v("likes")), line("Photos and logo", picked("photos").join(", ")));
  o.push("", "## 7. Practical", line("Domain", v("domain")), line("Deadline", v("deadline")), line("Must NOT say or show", v("avoid")));
  return o.join("\n");
}

$("#f").addEventListener("submit", (e) => {
  e.preventDefault(); contact();
  const bad = $$("input:invalid, textarea:invalid", $("#f"))[0];
  if (bad) { if (bad.id === "wa") { $("#cerr").dataset.show = "1"; contact(); } $("#msg").textContent = "Please complete the fields marked *."; bad.focus(); bad.reportValidity(); return; }
  $("#msg").textContent = ""; $("#sum").value = build(); $("#out").style.display = "block";
  $("#out").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
});
$("#copy").onclick = async () => { try { await navigator.clipboard.writeText($("#sum").value); } catch { $("#sum").select(); document.execCommand("copy"); } $("#copy").textContent = "Copied"; setTimeout(() => ($("#copy").textContent = "Copy"), 1800); };
$("#dl").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([$("#sum").value], { type: "text/plain" })); a.download = (v("name") || "company").replace(/\W+/g, "-").toLowerCase() + "-website-details.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
const LIMIT = 1800; // safe URL length for mailto / wa.me
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch { $("#sum").select(); return document.execCommand("copy"); } }
async function shortOrFull(full, stub) { if (encodeURIComponent(full).length <= LIMIT) return full; await copyText(full); $("#msg").textContent = "Summary is long, so it was copied. Paste it into the message."; return stub; }
if (CONFIG.email) { $("#mail").hidden = false; $("#mail").onclick = async () => { const b = await shortOrFull($("#sum").value, "(Paste the copied summary here)"); location.href = `mailto:${CONFIG.email}?subject=${encodeURIComponent("Website details: " + v("name"))}&body=${encodeURIComponent(b)}`; }; }
if (CONFIG.whatsapp) { $("#wapp").hidden = false; $("#wapp").onclick = async () => { const b = await shortOrFull($("#sum").value, "Hi, here are my website details for " + v("name") + ":"); window.open(`https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(b)}`, "_blank", "noopener"); }; }
if (!CONFIG.email && !CONFIG.whatsapp) $("#out > .hint:not(#sendmsg)").textContent = `Check it, then copy or download it and send it to ${CONFIG.owner}.`;

// Structured copy of the form for the server (same shape as shared/intake.ts IntakeData).
function collect() {
  return {
    businessName: v("name"), contactName: v("contact"), tagline: v("tag"), whatTheyDo: v("what"), location: v("loc"),
    whatsapp: v("wa"), email: v("email"), phone: v("phone"), social: v("social"),
    pages: picked("pages"), otherPages: v("otherpages"), categories: v("cats"),
    products: rows("products"), services: rows("services"), steps: v("steps"),
    about: v("about"), facts: v("facts"), colors: v("colors"), styles: picked("styles"), likes: v("likes"),
    photos: picked("photos"), domain: v("domain"), deadline: v("deadline"), avoid: v("avoid"),
  };
}
if (CONFIG.submitUrl) {
  $("#send").hidden = false;
  $("#send").onclick = async () => {
    const btn = $("#send"), note = $("#sendmsg");
    btn.disabled = true; note.textContent = "Sending…";
    try {
      const res = await fetch(CONFIG.submitUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: collect(), hp: v("hp"), elapsedMs: Date.now() - startedAt }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok) { note.textContent = `Thank you. We received your details${j.reference && j.reference !== "-" ? ` (reference ${j.reference})` : ""} and will contact you soon.`; btn.textContent = "Sent"; return; }
      const fields = j.fields ? Object.values(j.fields).join(" ") : "";
      note.textContent = (j.error || "We could not send your details.") + (fields ? " " + fields : "") + " You can also copy, email or WhatsApp the summary below.";
    } catch { note.textContent = "Could not reach the server. Please copy, email or WhatsApp the summary instead."; }
    btn.disabled = false;
  };
}
