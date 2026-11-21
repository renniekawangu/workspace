import { describe, expect, it } from "vitest";
import { blankIntake } from "./intake";
import {
  addDays,
  clientFields,
  leadFields,
  projectFields,
} from "./intakeLinks";

const d = () => ({
  ...blankIntake(),
  businessName: "Zuri Jewels",
  whatTheyDo: "Rings",
  whatsapp: "+260 770 000 000",
  categories: "Rings, Watches",
});

describe("intake links", () => {
  it("falls back to the business name when there is no contact person", () => {
    expect(leadFields(d()).contactName).toBe("Zuri Jewels");
    expect(leadFields({ ...d(), contactName: "Thandi" }).contactName).toBe(
      "Thandi",
    );
  });
  it("prefers WhatsApp for phone and uses the first category as industry", () => {
    expect(leadFields(d()).phone).toBe("+260 770 000 000");
    expect(clientFields(d()).industry).toBe("Rings");
  });
  it("respects the field lengths the rules enforce", () => {
    const long = {
      ...d(),
      businessName: "x".repeat(300),
      whatTheyDo: "y".repeat(5000),
    };
    expect(leadFields(long).company.length).toBe(160);
    expect(leadFields(long).notes.length).toBe(3000);
    expect(
      projectFields(long, "c1", "u1", "2026-11-20").description.length,
    ).toBeLessThanOrEqual(4000);
  });
  it("uses a typed deadline, otherwise 30 days out", () => {
    expect(
      projectFields(
        { ...d(), deadline: "2026-12-24" },
        "c1",
        "u1",
        "2026-11-20",
      ).dueDate,
    ).toBe("2026-12-24");
    expect(
      projectFields(
        { ...d(), deadline: "end of Dec" },
        "c1",
        "u1",
        "2026-11-20",
      ).dueDate,
    ).toBe("2026-12-20");
    expect(
      projectFields(
        { ...d(), deadline: "2026-01-01" },
        "c1",
        "u1",
        "2026-11-20",
      ).dueDate,
    ).toBe("2026-12-20");
    expect(projectFields(d(), "c1", "u1", "2026-11-20").memberIds).toEqual([
      "u1",
    ]);
  });
  it("adds days across month ends", () =>
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04"));
});
