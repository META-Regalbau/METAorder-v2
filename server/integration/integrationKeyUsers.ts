import type { Role, User } from "@shared/schema";
import type { IStorage } from "../storage";

/**
 * Unter welchem Benutzer arbeitet ein Integrations-Schluessel (n8n)? Ein Schluessel ohne Bindung
 * laeuft ueber den Ersatz-Benutzer (METAORDER_INTEGRATION_USER_ID bzw. "n8n-service"). Den legt der
 * Start nur mit N8N_SERVICE_PASSWORD an, in Produktion fehlte er - jeder n8n-Aufruf scheiterte mit
 * "Kein Integrations-Benutzer gefunden". Die Einstellungen zeigen deshalb Benutzer, Mitgliedschaft und
 * die Rechte, die das Auspacken von E-Mails braucht (Angebote UND Bestellentwuerfe bearbeiten).
 */
export type IntegrationUserInfo = {
  id: string;
  username: string;
  roleName: string | null;
  /** Mitglied des Mandanten, fuer den der Schluessel gilt (sonst 403 bei jedem Aufruf) */
  isTenantMember: boolean;
  canManageOffers: boolean;
  canManageOrderDrafts: boolean;
  /** Mitglied und beide Rechte: E-Mails werden ausgepackt, je Beleg ein Entwurf */
  ready: boolean;
};

/** Ersatz-Benutzer fuer Schluessel ohne Bindung (wie in requireAuthOrIntegrationKey) */
export async function loadFallbackIntegrationUser(storage: Pick<IStorage, "getUser" | "getUserByUsername">): Promise<User | null> {
  const explicitUserId = process.env.METAORDER_INTEGRATION_USER_ID?.trim();
  const user = explicitUserId ? await storage.getUser(explicitUserId) : await storage.getUserByUsername("n8n-service");
  return user ?? null;
}

function allows(role: Role | undefined, permission: string): boolean {
  const permissions = (role as { permissions?: unknown } | undefined)?.permissions;
  if (!permissions) return false;
  if (Array.isArray(permissions)) return permissions.includes(permission);
  return Boolean((permissions as Record<string, unknown>)[permission]);
}

/** Rolle wie bei der Anmeldung: roleId, sonst Altbenutzer ueber den Rollennamen (ohne zu speichern) */
async function roleOf(storage: Pick<IStorage, "getRole" | "getAllRoles">, user: User): Promise<Role | undefined> {
  const roleId = (user as { roleId?: string | null }).roleId;
  if (roleId) return storage.getRole(roleId);
  const legacyName = user.role === "admin" ? "Administrator" : "Employee";
  return (await storage.getAllRoles()).find((role) => role.name === legacyName);
}

export async function describeIntegrationUser(
  storage: Pick<IStorage, "getRole" | "getAllRoles" | "getTenantsForUser">,
  user: User,
  tenantId: string,
): Promise<IntegrationUserInfo> {
  const [role, tenants] = await Promise.all([roleOf(storage, user), storage.getTenantsForUser(user.id)]);
  const isTenantMember = tenants.some((tenant) => tenant.id === tenantId);
  const canManageOffers = allows(role, "manageOffers");
  const canManageOrderDrafts = allows(role, "manageOrderDrafts");
  return {
    id: user.id,
    username: user.username,
    roleName: role?.name ?? null,
    isTenantMember,
    canManageOffers,
    canManageOrderDrafts,
    ready: isTenantMember && canManageOffers && canManageOrderDrafts,
  };
}

/** Moegliche Benutzer fuer einen Schluessel: Mitglieder des Mandanten, geeignete zuerst */
export async function listIntegrationUserCandidates(
  storage: Pick<IStorage, "getAllUsers" | "getRole" | "getAllRoles" | "getTenantsForUser">,
  tenantId: string,
): Promise<IntegrationUserInfo[]> {
  const users = await storage.getAllUsers();
  const described = await Promise.all(users.map((user) => describeIntegrationUser(storage, user, tenantId)));
  return described
    .filter((info) => info.isTenantMember)
    .sort((a, b) => Number(b.ready) - Number(a.ready) || a.username.localeCompare(b.username));
}
