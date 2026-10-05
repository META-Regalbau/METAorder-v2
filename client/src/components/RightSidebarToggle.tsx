import { Ticket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useRightSidebar } from "@/components/RightSidebarContext";

/** Unter 1280 px: oeffnet die Schnellbearbeitung (rechte Leiste) ueber dem Inhalt. Breiter sitzt der Knopf in der Leiste. */
export default function RightSidebarToggle() {
  const { t } = useTranslation();
  const { mobileOpen, setMobileOpen } = useRightSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="xl:hidden"
      onClick={() => setMobileOpen(!mobileOpen)}
      aria-label={t("tickets.quickEdit.title")}
      aria-expanded={mobileOpen}
      data-testid="button-open-right-sidebar-mobile"
    >
      <Ticket className="h-5 w-5" />
    </Button>
  );
}
