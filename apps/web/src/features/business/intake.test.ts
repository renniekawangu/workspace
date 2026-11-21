import { describe, expect, it } from "vitest";
import {
  blankIntake,
  buildBrief,
  buildSummary,
  cleanIntake,
  parseSummary,
  sanitizeIntake,
  validateIntake,
  type IntakeData,
} from "./intake";

const sample = (): IntakeData => ({
  ...blankIntake(),
  businessName: "Zuri Jewels",
  whatTheyDo: "Handmade rings and watches.\nSecond line",
  location: "Ndola, Zambia",
  whatsapp: "+260 770 000 000",
  pages: ["Home", "Contact"],
  styles: ["Elegant", "Minimal"],
  photos: ["I have a logo"],
  colors: "gold, black",
  products: [
    {
      name: "Ring | Gold",
      category: "Rings",
      desc: "",
      price: "",
      photo: "ring1.jpg",
    },
  ],
  services: [{ name: "Engraving", desc: "Free with any ring" }],
});

describe("intake summary", () => {
  it("round-trips through build and parse", () => {
    const back = parseSummary(buildSummary(sample()))!;
    expect(back.businessName).toBe("Zuri Jewels");
    expect(back.whatTheyDo).toBe("Handmade rings and watches. / Second line");
    expect(back.pages).toEqual(["Home", "Contact"]);
    expect(back.styles).toEqual(["Elegant", "Minimal"]);
    expect(back.photos).toEqual(["I have a logo"]);
    expect(back.products).toEqual([
      {
        name: "Ring / Gold",
        category: "Rings",
        desc: "",
        price: "",
        photo: "ring1.jpg",
      },
    ]);
    expect(back.services).toEqual([
      { name: "Engraving", desc: "Free with any ring" },
    ]);
    expect(back.tagline).toBe("");
  });
  it("returns null for unrelated text", () => {
    expect(parseSummary("hello there")).toBeNull();
    expect(parseSummary("")).toBeNull();
  });
});

describe("validateIntake", () => {
  it("requires name, what, location and one way to be reached", () => {
    const e = validateIntake(blankIntake());
    expect(Object.keys(e).sort()).toEqual([
      "businessName",
      "location",
      "whatTheyDo",
      "whatsapp",
    ]);
    expect(validateIntake(sample())).toEqual({});
  });
  it("accepts phone alone and rejects a bad email", () => {
    const d = { ...sample(), whatsapp: "", phone: "0970000000" };
    expect(validateIntake(d)).toEqual({});
    expect(validateIntake({ ...d, email: "nope" }).email).toBeTruthy();
  });
  it("enforces length limits", () => {
    expect(
      validateIntake({ ...sample(), tagline: "x".repeat(201) }).tagline,
    ).toBeTruthy();
  });
});

describe("cleanIntake", () => {
  it("trims and drops empty rows", () => {
    const d = cleanIntake({
      ...sample(),
      businessName: "  Zuri  ",
      products: [{ name: " ", category: "", desc: "", price: "", photo: "" }],
      services: [],
    });
    expect(d.businessName).toBe("Zuri");
    expect(d.products).toEqual([]);
  });
});

describe("sanitizeIntake", () => {
  it("drops unknown keys, bad types and unknown options", () => {
    const d = sanitizeIntake({
      businessName: "Zuri",
      location: 5,
      evil: "x",
      pages: ["Home", "Hacked", 3],
      styles: "Elegant",
      products: [{ name: "Ring", price: 9 }, "x", null],
      services: [{ name: "Fit" }],
    });
    expect(d.businessName).toBe("Zuri");
    expect(d.location).toBe("");
    expect(d).not.toHaveProperty("evil");
    expect(d.pages).toEqual(["Home"]);
    expect(d.styles).toEqual([]);
    expect(d.products).toEqual([
      { name: "Ring", category: "", desc: "", price: "", photo: "" },
    ]);
    expect(d.services).toEqual([{ name: "Fit", desc: "" }]);
  });
  it("does not truncate oversized values, so validation can reject them", () => {
    const d = sanitizeIntake({ ...sample(), tagline: "x".repeat(500) });
    expect(validateIntake(d).tagline).toBeTruthy();
  });
  it("caps row counts at limit+1 so the limit error still fires", () => {
    const d = sanitizeIntake({
      ...sample(),
      products: Array.from({ length: 500 }, () => ({ name: "a" })),
    });
    expect(d.products.length).toBe(31);
    expect(validateIntake(d).products).toBeTruthy();
  });
  it("handles non-object input", () => {
    expect(sanitizeIntake(null).businessName).toBe("");
    expect(sanitizeIntake("hi").pages).toEqual([]);
  });
});

describe("buildBrief", () => {
  it("includes facts, a wa.me link and placeholders for missing data", () => {
    const b = buildBrief({ ...sample(), whatsapp: "+260 770 000 000" });
    expect(b).toContain("Zuri Jewels");
    expect(b).toContain("https://wa.me/260770000000");
    expect(b).toContain("price on enquiry");
    expect(b).toContain("Tagline: (not provided)");
    expect(b).toContain("Do not invent");
  });
  it("does not break on an empty intake", () => {
    expect(buildBrief(blankIntake())).toContain("Untitled business");
  });
});
