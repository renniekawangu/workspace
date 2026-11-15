import type { Department, Role } from "./enums";

export const BUSINESS_ROLES = ["admin", "bizops"] as const;
export const REPORT_ROLES = ["admin", "bizops", "digitalops"] as const;
export const DIGITAL_ROLES = ["admin", "digitalops", "designer"] as const;

export const hasRole = (role: Role | null, allowed: readonly Role[]) =>
  role !== null && allowed.includes(role);

export const isAdmin = (role: Role | null) => role === "admin";
export const isBusinessRole = (role: Role | null) =>
  hasRole(role, BUSINESS_ROLES);
export const isReportsRole = (role: Role | null) =>
  hasRole(role, REPORT_ROLES);
export const isDigitalRole = (role: Role | null) =>
  hasRole(role, DIGITAL_ROLES);
export const canCreateTasks = (role: Role | null) =>
  isAdmin(role) || isBusinessRole(role) || isDigitalRole(role);
export const canManageOnboarding = (role: Role | null) =>
  isAdmin(role) || role === "bizops";
export const canManageAnnouncements = (role: Role | null) =>
  isAdmin(role) || role === "bizops";
export const canManageBusiness = (role: Role | null) =>
  isAdmin(role) || role === "bizops";
export const canManageCampaigns = (role: Role | null) =>
  isAdmin(role) || role === "bizops" || role === "digitalops";
export const canManageDigital = (role: Role | null) =>
  isAdmin(role) || role === "digitalops";
export const canCreateDigitalContent = (role: Role | null) =>
  isAdmin(role) || role === "digitalops" || role === "designer";
export const canManageProjects = (role: Role | null) =>
  isAdmin(role) || role === "bizops";
export const canAccessDirectory = (role: Role | null) =>
  isAdmin(role) || role === "employee";
export const canAccessFinance = (role: Role | null) => isAdmin(role);
/** Only admins can list every leave/attendance record; approvers see theirs. */
export const canReviewLeave = (role: Role | null) => isAdmin(role);
export const canViewStaffProfile = (
  role: Role | null,
  currentUserId: string | null | undefined,
  targetUserId: string,
) => isAdmin(role) || currentUserId === targetUserId;
export const canViewDepartmentTasks = (role: Role | null, department: Department) =>
  isAdmin(role) || getRoleDepartment(role) === department;

export const getRoleDepartment = (role: Role | null): Department | null => {
  switch (role) {
    case "bizops":
      return "business";
    case "digitalops":
      return "digital";
    case "designer":
      return "creative";
    case "employee":
      return "technical";
    default:
      return null;
  }
};

/**
 * Department scope for department-wide task queries. Employees are deliberately
 * absent: the rules let them read only tasks assigned to them, so a department
 * query would be rejected outright.
 */
export const ROLE_DEPT: Partial<Record<Role, Department>> = {
  bizops: "business",
  digitalops: "digital",
  designer: "creative",
};
