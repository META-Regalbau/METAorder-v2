import type { PortalRegistrationStatus } from "@shared/portalRegistrations";

export function registrationStatusVariant(status: PortalRegistrationStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "failed":
      return "destructive";
    case "review":
    case "ready":
      return "secondary";
    default:
      return "outline";
  }
}
