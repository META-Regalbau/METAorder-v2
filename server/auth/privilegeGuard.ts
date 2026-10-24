/**
 * Schutz der Benutzer- und Rollenverwaltung gegen Rechte-Ausweitung.
 *
 * manageUsers/manageRoles sind delegierbare Rechte. Ohne diese Prüfungen hätte, wer sie hat, sich selbst zum
 * Administrator machen, sich alle Rechte geben oder Passwörter von Benutzern anderer Mandanten setzen können.
 * Regeln (Administratoren sind ausgenommen):
 * - Die Rolle „Administrator“ vergibt, ändert, benennt oder löscht nur ein Administrator.
 * - Niemand vergibt Rechte, die er selbst nicht hat (beim Zuweisen einer Rolle und beim Bearbeiten von Rollen).
 * - Benutzer, die Administrator sind oder mit denen man keinen Mandanten teilt, bleiben unangetastet.
 */
export const ADMINISTRATOR_ROLE_NAME = "Administrator";

export function isAdministratorRoleName(name: unknown): boolean {
  return typeof name === "string" && name.trim().toLowerCase() === ADMINISTRATOR_ROLE_NAME.toLowerCase();
}

/** Administrator: Rolle „Administrator“ oder Alt-Kennzeichen role = "admin" (auth.ts leitet diese Funktion weiter). */
export function isAdministrator(user: any): boolean {
  return user?.role === "admin" || user?.roleDetails?.name === ADMINISTRATOR_ROLE_NAME;
}

/** Rechte als Menge – Rollen speichern sie als Liste oder als Objekt { recht: true }. */
export function permissionSet(permissions: unknown): Set<string> {
  if (Array.isArray(permissions)) return new Set(permissions.filter((p): p is string => typeof p === "string"));
  if (permissions && typeof permissions === "object") {
    return new Set(Object.entries(permissions as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => k));
  }
  return new Set();
}

type Actor = { role?: string; roleDetails?: { name?: string; permissions?: unknown } | null } | null | undefined;
type RoleLike = { name?: string | null; permissions?: unknown } | null | undefined;

/** Rechte, die `next` gegenüber `before` neu vergibt. */
function newlyGranted(next: unknown, before: unknown): string[] {
  const had = permissionSet(before);
  return [...permissionSet(next)].filter((p) => !had.has(p));
}

/**
 * Fehlertext, wenn der Handelnde diese Rolle nicht vergeben bzw. so speichern darf, sonst null.
 * `before`: Stand der Rolle vor der Änderung (beim Zuweisen und Neuanlegen weglassen).
 */
export function roleChangeError(actor: Actor, role: RoleLike, before?: RoleLike): string | null {
  if (isAdministrator(actor)) return null;
  if (isAdministratorRoleName(role?.name) || isAdministratorRoleName(before?.name)) {
    return "Die Rolle Administrator kann nur ein Administrator vergeben oder ändern.";
  }
  const mine = permissionSet(actor?.roleDetails?.permissions);
  const missing = newlyGranted(role?.permissions, before?.permissions).filter((p) => !mine.has(p));
  return missing.length ? `Rechte, die Sie selbst nicht haben, können Sie nicht vergeben: ${missing.join(", ")}` : null;
}

type TargetUser = { id: string; role?: string | null; roleId?: string | null } | null | undefined;

/**
 * Fehlertext, wenn der Handelnde diesen Benutzer nicht ändern/löschen darf, sonst null.
 * `targetRole`: die Rolle des Zielbenutzers; `sharesTenant`: ob beide mindestens einen Mandanten teilen.
 */
export function userChangeError(actor: Actor, target: TargetUser, targetRole: RoleLike, sharesTenant: boolean): string | null {
  if (isAdministrator(actor)) return null;
  if (target?.role === "admin" || isAdministratorRoleName(targetRole?.name)) {
    return "Administratoren kann nur ein Administrator ändern.";
  }
  if (!sharesTenant) return "Dieser Benutzer gehört zu keinem Ihrer Mandanten.";
  return null;
}
