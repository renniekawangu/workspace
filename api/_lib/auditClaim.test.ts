import { describe, expect, it } from "vitest";
import {
  auditDocId,
  claimStamp,
  parseAuditClaim,
  RECENT_MS,
} from "./auditClaim";

const now = 1_800_000_000_000;
const ts = (ms: number) => ({ toMillis: () => ms });
const claim = {
  action: "lead.updated",
  targetType: "lead",
  targetId: "abc123",
};

describe("parseAuditClaim", () => {
  it("accepts well-formed claims", () => {
    expect(parseAuditClaim(claim)).toEqual(claim);
    expect(
      parseAuditClaim({
        action: "digital.post_pending_approval",
        targetType: "socialPost",
        targetId: "x_Y-1",
      }),
    ).not.toBeNull();
  });
  it.each([
    [{ ...claim, action: "Lead Updated" }],
    [{ ...claim, action: "nodot" }],
    [{ ...claim, targetType: "a/b" }],
    [{ ...claim, targetId: "a/b" }],
    [{ ...claim, targetId: "" }],
    [{ ...claim, action: "a.".repeat(60) + "b" }],
    [null],
    ["x"],
    [{ ...claim, targetId: 5 }],
  ])("rejects %j", (bad) => expect(parseAuditClaim(bad)).toBeNull());
});

describe("claimStamp", () => {
  const doc = (over: Record<string, unknown> = {}) => ({
    updatedBy: "u1",
    createdBy: "u9",
    updatedAt: ts(now - 5_000),
    ...over,
  });
  it("accepts a recent change by the caller", () =>
    expect(claimStamp(claim, doc(), "u1", now)).toBe(now - 5_000));
  it("rejects a change by someone else", () =>
    expect(claimStamp(claim, doc(), "u2", now)).toBeNull());
  it("rejects a stale change", () =>
    expect(
      claimStamp(claim, doc({ updatedAt: ts(now - RECENT_MS - 1) }), "u1", now),
    ).toBeNull());
  it("rejects a future timestamp", () =>
    expect(
      claimStamp(claim, doc({ updatedAt: ts(now + 120_000) }), "u1", now),
    ).toBeNull());
  it("rejects a missing document", () =>
    expect(claimStamp(claim, undefined, "u1", now)).toBeNull());
  it("falls back to createdAt", () =>
    expect(
      claimStamp(
        claim,
        { createdBy: "u1", createdAt: ts(now - 1000) },
        "u1",
        now,
      ),
    ).toBe(now - 1000));
  it("matches attendance by employeeId", () => {
    const c = {
      action: "attendance.checked_in",
      targetType: "attendance",
      targetId: "u1_2026-11-20",
    };
    expect(
      claimStamp(c, { employeeId: "u1", updatedAt: ts(now) }, "u1", now),
    ).toBe(now);
    expect(
      claimStamp(c, { employeeId: "u2", updatedAt: ts(now) }, "u1", now),
    ).toBeNull();
  });
  it("matches leave by employee, approver or decider", () => {
    const c = { action: "leave.approved", targetType: "leave", targetId: "l1" };
    const l = {
      employeeId: "e",
      approverId: "a",
      decidedBy: "a",
      updatedAt: ts(now),
    };
    expect(claimStamp(c, l, "a", now)).toBe(now);
    expect(claimStamp(c, l, "z", now)).toBeNull();
  });
  it("accepts a deletion only when the document is gone", () => {
    const c = {
      action: "announcement.deleted",
      targetType: "announcement",
      targetId: "n1",
    };
    expect(claimStamp(c, undefined, "u1", now)).not.toBeNull();
    expect(claimStamp(c, doc(), "u1", now)).toBeNull();
  });
});

describe("auditDocId", () => {
  it("is stable for the same change and differs otherwise", () => {
    expect(auditDocId(claim, "u1", 1)).toBe(auditDocId(claim, "u1", 1));
    expect(auditDocId(claim, "u1", 1)).not.toBe(auditDocId(claim, "u1", 2));
    expect(auditDocId(claim, "u1", 1)).not.toBe(auditDocId(claim, "u2", 1));
    expect(auditDocId(claim, "u1", 1)).toHaveLength(32);
  });
});
