export function roleCanAccess(role, allowedRoles = []) {
  return allowedRoles.length === 0 || allowedRoles.includes(role);
}
