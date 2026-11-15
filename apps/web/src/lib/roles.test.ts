import { describe, expect, it } from "vitest";
import {
  ROLE_DEPT,
  canAccessDirectory,
  canAccessFinance,
  canCreateDigitalContent,
  canCreateTasks,
  canManageAnnouncements,
  canManageBusiness,
  canManageCampaigns,
  canManageDigital,
  canManageOnboarding,
  canManageProjects,
  canReviewLeave,
  canViewDepartmentTasks,
  canViewStaffProfile,
  getRoleDepartment,
  hasRole,
  isAdmin,
  isBusinessRole,
  isDigitalRole,
  isReportsRole,
} from "./roles";

describe("role helpers", () => {
  it("accepts only allowed roles", () => {
    expect(hasRole("admin", ["admin"])).toBe(true);
    expect(hasRole("employee", ["admin"])).toBe(false);
    expect(hasRole(null, ["admin"])).toBe(false);
    expect(isAdmin("admin")).toBe(true);
    expect(isAdmin("bizops")).toBe(false);
  });

  it("groups access for business, digital, and reports pages", () => {
    expect(isBusinessRole("admin")).toBe(true);
    expect(isBusinessRole("bizops")).toBe(true);
    expect(isBusinessRole("employee")).toBe(false);
    expect(isDigitalRole("designer")).toBe(true);
    expect(isDigitalRole("employee")).toBe(false);
    expect(isReportsRole("digitalops")).toBe(true);
    expect(isReportsRole("designer")).toBe(false);
    expect(isReportsRole(null)).toBe(false);
    expect(canCreateTasks("designer")).toBe(true);
    expect(canCreateTasks("employee")).toBe(false);
    expect(canManageOnboarding("bizops")).toBe(true);
    expect(canManageOnboarding("designer")).toBe(false);
    expect(canManageAnnouncements("admin")).toBe(true);
    expect(canManageAnnouncements("bizops")).toBe(true);
    expect(canManageAnnouncements("employee")).toBe(false);
    expect(canManageCampaigns("bizops")).toBe(true);
    expect(canManageCampaigns("digitalops")).toBe(true);
    expect(canManageCampaigns("designer")).toBe(false);
    expect(canManageBusiness("bizops")).toBe(true);
    expect(canManageBusiness("employee")).toBe(false);
    expect(canManageDigital("digitalops")).toBe(true);
    expect(canManageDigital("designer")).toBe(false);
    expect(canCreateDigitalContent("designer")).toBe(true);
    expect(canCreateDigitalContent("employee")).toBe(false);
    expect(canManageProjects("bizops")).toBe(true);
    expect(canManageProjects("employee")).toBe(false);
    expect(canAccessDirectory("admin")).toBe(true);
    expect(canAccessDirectory("employee")).toBe(true);
    expect(canAccessDirectory("bizops")).toBe(false);
    expect(canAccessDirectory("digitalops")).toBe(false);
    expect(canAccessDirectory("designer")).toBe(false);
    expect(canAccessFinance("admin")).toBe(true);
    expect(canAccessFinance("bizops")).toBe(false);
    expect(canAccessFinance("digitalops")).toBe(false);
    expect(canViewStaffProfile("admin", "u1", "u2")).toBe(true);
    expect(canViewStaffProfile("employee", "u1", "u2")).toBe(false);
    expect(canViewStaffProfile("employee", "u2", "u2")).toBe(true);
    expect(canViewDepartmentTasks("bizops", "business")).toBe(true);
    expect(canViewDepartmentTasks("designer", "business")).toBe(false);
    expect(canReviewLeave("admin")).toBe(true);
    expect(canReviewLeave("employee")).toBe(false);
    expect(getRoleDepartment("bizops")).toBe("business");
    expect(getRoleDepartment("employee")).toBe("technical");
    expect(getRoleDepartment("designer")).toBe("creative");
  });

  it("does not let bizops or employees list all leave, and never scopes employees by department", () => {
    expect(canReviewLeave("bizops")).toBe(false);
    expect(ROLE_DEPT.employee).toBeUndefined();
    expect(ROLE_DEPT.bizops).toBe("business");
  });
});
