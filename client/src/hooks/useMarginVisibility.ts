import { useQuery } from "@tanstack/react-query";
import type { Role, User } from "@shared/schema";

type MeResponse = {
  user: User & { permissions?: Role["permissions"]; roleName?: string | null };
} | null;

/** Darf genaue DB-Werte sehen (Recht viewMarginDetails oder Administrator)? Sonst nur die Ampel. */
export function canViewMarginDetailsFor(user: NonNullable<MeResponse>["user"] | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin" || user.roleName === "Administrator") return true;
  return Boolean(user.permissions?.viewMarginDetails);
}

/**
 * Die Rechte stehen auch im Server: ohne das Recht kommen die Zahlen gar nicht erst an.
 * Im Client blendet der Hook nur Spalten, Links und Seiten aus, die sonst leer wären.
 */
export function useCanViewMarginDetails(): boolean {
  const { data } = useQuery<MeResponse>({
    queryKey: ["/api/auth/me"],
    retry: false,
  });
  return canViewMarginDetailsFor(data?.user);
}
