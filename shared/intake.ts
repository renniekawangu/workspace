export const INTAKE_STATUSES = [
  "new",
  "in_review",
  "building",
  "delivered",
  "archived",
] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export const PAGE_OPTIONS = [
  "Home",
  "About",
  "Products / Collection",
  "Services",
  "Contact",
] as const;
export const STYLE_OPTIONS = [
  "Elegant",
  "Bold",
  "Friendly",
  "Modern",
  "Traditional",
  "Minimal",
] as const;
export const PHOTO_OPTIONS = [
  "I have product photos",
  "I have a logo",
  "Use stand-in photos for now",
] as const;

export type IntakeProduct = {
  name: string;
  category: string;
  desc: string;
  price: string;
  photo: string;
};
export type IntakeService = { name: string; desc: string };

export type IntakeData = {
  businessName: string;
  contactName: string;
  tagline: string;
  whatTheyDo: string;
  location: string;
  whatsapp: string;
  email: string;
  phone: string;
  social: string;
  pages: string[];
  otherPages: string;
  categories: string;
  products: IntakeProduct[];
  services: IntakeService[];
  steps: string;
  about: string;
  facts: string;
  colors: string;
  styles: string[];
  likes: string;
  photos: string[];
  domain: string;
  deadline: string;
  avoid: string;
};

/** Max lengths. Mirrored in firebase/firestore.rules (`intake()`); keep both in sync. */
export const LIMITS = {
  businessName: 160,
  contactName: 160,
  tagline: 200,
  whatTheyDo: 1000,
  location: 160,
  whatsapp: 40,
  email: 254,
  phone: 40,
  social: 1000,
  otherPages: 300,
  categories: 500,
  steps: 1000,
  about: 2000,
  facts: 1000,
  colors: 200,
  likes: 1000,
  domain: 253,
  deadline: 100,
  avoid: 1000,
  products: 30,
  services: 20,
  productField: 300,
  serviceField: 300,
} as const;

export const blankIntake = (): IntakeData => ({
  businessName: "",
  contactName: "",
  tagline: "",
  whatTheyDo: "",
  location: "",
  whatsapp: "",
  email: "",
  phone: "",
  social: "",
  pages: [...PAGE_OPTIONS],
  otherPages: "",
  categories: "",
  products: [],
  services: [],
  steps: "",
  about: "",
  facts: "",
  colors: "",
  styles: [],
  likes: "",
  photos: [],
  domain: "",
  deadline: "",
  avoid: "",
});

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns a map of field -> message. Empty map means valid. */
export function validateIntake(d: IntakeData): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.businessName.trim()) e.businessName = "Business name is required.";
  if (!d.whatTheyDo.trim()) e.whatTheyDo = "Say what they sell or do.";
  if (!d.location.trim()) e.location = "Location is required.";
  if (!d.whatsapp.trim() && !d.email.trim() && !d.phone.trim())
    e.whatsapp = "Add a WhatsApp number, phone or email.";
  if (d.email.trim() && !EMAIL_OK.test(d.email.trim()))
    e.email = "Enter a valid email or leave it blank.";
  for (const k of [
    "businessName",
    "contactName",
    "tagline",
    "whatTheyDo",
    "location",
    "whatsapp",
    "email",
    "phone",
    "social",
    "otherPages",
    "categories",
    "steps",
    "about",
    "facts",
    "colors",
    "likes",
    "domain",
    "deadline",
    "avoid",
  ] as const) {
    if (d[k].length > LIMITS[k])
      e[k] = `Keep this under ${LIMITS[k]} characters.`;
  }
  if (d.products.length > LIMITS.products)
    e.products = `At most ${LIMITS.products} products.`;
  if (d.services.length > LIMITS.services)
    e.services = `At most ${LIMITS.services} services.`;
  if (
    d.products.some((p) =>
      Object.values(p).some((v) => v.length > LIMITS.productField),
    )
  )
    e.products = `Product fields must be under ${LIMITS.productField} characters.`;
  if (
    d.services.some((s) =>
      Object.values(s).some((v) => v.length > LIMITS.serviceField),
    )
  )
    e.services = `Service fields must be under ${LIMITS.serviceField} characters.`;
  return e;
}

/** Trim everything and drop empty product/service rows before saving. */
export function cleanIntake(d: IntakeData): IntakeData {
  const t = (s: string) => s.trim();
  return {
    ...d,
    businessName: t(d.businessName),
    contactName: t(d.contactName),
    tagline: t(d.tagline),
    whatTheyDo: t(d.whatTheyDo),
    location: t(d.location),
    whatsapp: t(d.whatsapp),
    email: t(d.email),
    phone: t(d.phone),
    social: t(d.social),
    otherPages: t(d.otherPages),
    categories: t(d.categories),
    steps: t(d.steps),
    about: t(d.about),
    facts: t(d.facts),
    colors: t(d.colors),
    likes: t(d.likes),
    domain: t(d.domain),
    deadline: t(d.deadline),
    avoid: t(d.avoid),
    products: d.products
      .map((p) => ({
        name: t(p.name),
        category: t(p.category),
        desc: t(p.desc),
        price: t(p.price),
        photo: t(p.photo),
      }))
      .filter((p) => Object.values(p).some(Boolean)),
    services: d.services
      .map((s) => ({ name: t(s.name), desc: t(s.desc) }))
      .filter((s) => Object.values(s).some(Boolean)),
  };
}

/* ---- Summary text: identical format to /intake (the client-facing form) ---- */

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " / ").trim();
const cell = (s: string) => oneLine(s).replace(/\|/g, "/");
const line = (k: string, v: string) =>
  `- ${k}: ${oneLine(v) || "(not provided)"}`;

export function buildSummary(d: IntakeData): string {
  const o: string[] = [
    "# Company intake",
    "",
    "## 1. Business basics",
    line("Business name", d.businessName),
    line("Contact person", d.contactName),
    line("Tagline", d.tagline),
    line("What we sell or do", d.whatTheyDo),
    line("Location", d.location),
    line("WhatsApp", d.whatsapp),
    line("Email", d.email),
    line("Phone", d.phone),
    line("Social media", d.social),
  ];
  o.push(
    "",
    "## 2. Pages",
    line("Pages wanted", d.pages.join(", ")),
    line("Other pages", d.otherPages),
  );
  o.push("", "## 3. Products", line("Categories", d.categories));
  for (const p of d.products)
    o.push(
      `- Product: ${cell(p.name) || "(unnamed)"} | category: ${cell(p.category) || "-"} | description: ${cell(p.desc) || "-"} | price: ${cell(p.price) || "on enquiry"} | photo: ${cell(p.photo) || "-"}`,
    );
  o.push("", "## 4. Services");
  for (const s of d.services)
    o.push(
      `- Service: ${cell(s.name) || "(unnamed)"} | ${cell(s.desc) || "-"}`,
    );
  o.push(line("How customers get started", d.steps));
  o.push(
    "",
    "## 5. About",
    line("Introduction", d.about),
    line("Facts to show (only if real)", d.facts),
  );
  o.push(
    "",
    "## 6. Look and feel",
    line("Brand colours", d.colors),
    line("Style", d.styles.join(", ")),
    line("Websites liked", d.likes),
    line("Photos and logo", d.photos.join(", ")),
  );
  o.push(
    "",
    "## 7. Practical",
    line("Domain", d.domain),
    line("Deadline", d.deadline),
    line("Must NOT say or show", d.avoid),
  );
  return o.join("\n");
}

const NONE = "(not provided)";
const val = (s: string) => (s === NONE || s === "-" ? "" : s);
const list = (s: string, allowed: readonly string[]) =>
  val(s)
    .split(",")
    .map((x) => x.trim())
    .filter((x) => allowed.includes(x));

/**
 * Parses a summary produced by the client form back into intake data.
 * Returns null when nothing recognisable is found.
 */
export function parseSummary(text: string): IntakeData | null {
  const d = blankIntake();
  d.pages = [];
  let hits = 0;
  const simple: Record<string, (v: string) => void> = {
    "Business name": (v) => (d.businessName = v),
    "Contact person": (v) => (d.contactName = v),
    Tagline: (v) => (d.tagline = v),
    "What we sell or do": (v) => (d.whatTheyDo = v),
    Location: (v) => (d.location = v),
    WhatsApp: (v) => (d.whatsapp = v),
    Email: (v) => (d.email = v),
    Phone: (v) => (d.phone = v),
    "Social media": (v) => (d.social = v),
    "Pages wanted": (v) => (d.pages = list(v, PAGE_OPTIONS)),
    "Other pages": (v) => (d.otherPages = v),
    Categories: (v) => (d.categories = v),
    "How customers get started": (v) => (d.steps = v),
    Introduction: (v) => (d.about = v),
    "Facts to show (only if real)": (v) => (d.facts = v),
    "Brand colours": (v) => (d.colors = v),
    Style: (v) => (d.styles = list(v, STYLE_OPTIONS)),
    "Websites liked": (v) => (d.likes = v),
    "Photos and logo": (v) => (d.photos = list(v, PHOTO_OPTIONS)),
    Domain: (v) => (d.domain = v),
    Deadline: (v) => (d.deadline = v),
    "Must NOT say or show": (v) => (d.avoid = v),
  };
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l.startsWith("- ")) continue;
    const body = l.slice(2);
    if (body.startsWith("Product: ")) {
      const [name = "", ...rest] = body.slice(9).split(" | ");
      const f: Record<string, string> = {};
      for (const part of rest) {
        const i = part.indexOf(": ");
        if (i > 0) f[part.slice(0, i)] = part.slice(i + 2);
      }
      const price = val(f.price ?? "");
      d.products.push({
        name: name === "(unnamed)" ? "" : name,
        category: val(f.category ?? ""),
        desc: val(f.description ?? ""),
        price: price === "on enquiry" ? "" : price,
        photo: val(f.photo ?? ""),
      });
      hits++;
    } else if (body.startsWith("Service: ")) {
      const [name = "", ...rest] = body.slice(9).split(" | ");
      d.services.push({
        name: name === "(unnamed)" ? "" : name,
        desc: val(rest.join(" | ")),
      });
      hits++;
    } else {
      const i = body.indexOf(": ");
      if (i < 1) continue;
      const set = simple[body.slice(0, i)];
      if (set) {
        set(val(body.slice(i + 2).trim()));
        hits++;
      }
    }
  }
  return hits === 0 ? null : d;
}

/* ---- Untrusted input (public form posts JSON) ---- */

const asStr = (v: unknown) => (typeof v === "string" ? v : "");
const asOptions = (v: unknown, allowed: readonly string[]) =>
  Array.isArray(v)
    ? [
        ...new Set(
          v.filter(
            (x): x is string => typeof x === "string" && allowed.includes(x),
          ),
        ),
      ]
    : [];
const asRows = (v: unknown, max: number): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v
        .slice(0, max + 1)
        .filter(
          (x): x is Record<string, unknown> =>
            typeof x === "object" && x !== null && !Array.isArray(x),
        )
    : [];

/**
 * Builds IntakeData from arbitrary JSON. Unknown keys are dropped, wrong types become "",
 * option lists keep only known options. Over-long values are NOT truncated: run
 * validateIntake() afterwards so oversized input is rejected rather than silently cut.
 */
export function sanitizeIntake(input: unknown): IntakeData {
  const o = (
    typeof input === "object" && input !== null ? input : {}
  ) as Record<string, unknown>;
  const d = blankIntake();
  for (const k of [
    "businessName",
    "contactName",
    "tagline",
    "whatTheyDo",
    "location",
    "whatsapp",
    "email",
    "phone",
    "social",
    "otherPages",
    "categories",
    "steps",
    "about",
    "facts",
    "colors",
    "likes",
    "domain",
    "deadline",
    "avoid",
  ] as const)
    d[k] = asStr(o[k]);
  d.pages = asOptions(o.pages, PAGE_OPTIONS);
  d.styles = asOptions(o.styles, STYLE_OPTIONS);
  d.photos = asOptions(o.photos, PHOTO_OPTIONS);
  d.products = asRows(o.products, LIMITS.products).map((p) => ({
    name: asStr(p.name),
    category: asStr(p.category),
    desc: asStr(p.desc),
    price: asStr(p.price),
    photo: asStr(p.photo),
  }));
  d.services = asRows(o.services, LIMITS.services).map((s) => ({
    name: asStr(s.name),
    desc: asStr(s.desc),
  }));
  return d;
}

/* ---- Build brief: a ready-to-paste prompt for whoever builds the site ---- */

const or = (s: string, fallback = "(not provided)") => oneLine(s) || fallback;

export function buildBrief(d: IntakeData): string {
  const digits = d.whatsapp.replace(/\D/g, "");
  const o: string[] = [
    `# Build brief: ${or(d.businessName, "Untitled business")}`,
    "",
    `Build a website for a small business in ${or(d.location, "(location not provided)")}.`,
    'Use only the facts in this brief. Where a value says "(not provided)", leave a clearly marked placeholder. Do not invent prices, awards, testimonials, years in business, addresses or contact details.',
    "",
    "## Business",
    `- Name: ${or(d.businessName)}`,
    `- Tagline: ${or(d.tagline)}`,
    `- What they sell or do: ${or(d.whatTheyDo)}`,
    `- Introduction: ${or(d.about)}`,
    `- Facts they want shown: ${or(d.facts)}`,
    "",
    "## Contact (use these for buttons and the contact page)",
    `- WhatsApp: ${or(d.whatsapp)}${digits.length >= 10 ? ` (link: https://wa.me/${digits})` : ""}`,
    `- Email: ${or(d.email)}`,
    `- Phone: ${or(d.phone)}`,
    `- Social: ${or(d.social)}`,
    `- Contact person: ${or(d.contactName)}`,
    "",
    "## Pages",
    `- Required: ${d.pages.join(", ") || "(not provided)"}`,
    `- Also: ${or(d.otherPages, "none")}`,
    "",
    "## Catalogue",
    `- Categories: ${or(d.categories)}`,
  ];
  if (d.products.length) {
    o.push(
      "",
      "| Product | Category | Description | Price | Photo file |",
      "|---|---|---|---|---|",
    );
    for (const p of d.products)
      o.push(
        `| ${cell(p.name) || "(unnamed)"} | ${cell(p.category) || "-"} | ${cell(p.desc) || "-"} | ${cell(p.price) || "price on enquiry"} | ${cell(p.photo) || "stand-in"} |`,
      );
  } else o.push("- No products listed. Use a short placeholder section.");
  o.push("", "## Services");
  if (d.services.length)
    for (const s of d.services)
      o.push(`- ${cell(s.name) || "(unnamed)"}: ${cell(s.desc) || "-"}`);
  else o.push("- None listed.");
  o.push(`- How customers order or get started: ${or(d.steps)}`);
  o.push(
    "",
    "## Look and feel",
    `- Brand colours: ${or(d.colors, "choose a tasteful palette")}`,
    `- Style: ${d.styles.join(", ") || "(not provided)"}`,
    `- Sites they like: ${or(d.likes)}`,
    `- Assets: ${d.photos.join(", ") || "(not provided)"}`,
  );
  o.push(
    "",
    "## Must not say or show",
    `- ${or(d.avoid, "nothing specified")}`,
  );
  o.push(
    "",
    "## Practical",
    `- Domain: ${or(d.domain)}`,
    `- Deadline: ${or(d.deadline)}`,
  );
  o.push(
    "",
    "## Quality bar",
    "- Mobile first, fast, accessible (labels, contrast, alt text, keyboard focus).",
    "- WhatsApp click-to-chat is the primary call to action when a number is given.",
    "- Page titles and meta descriptions on every page.",
    "- Finish with a short list of every placeholder and assumption you made.",
  );
  return o.join("\n");
}
