import type { PortalNewsStatus } from "@shared/portalNews";

export function newsStatusVariant(status: PortalNewsStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "published":
      return "default";
    case "failed":
      return "destructive";
    case "draft":
      return "secondary";
    default:
      return "outline";
  }
}
