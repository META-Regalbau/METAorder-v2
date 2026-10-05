import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Role } from "@shared/schema";
import { useRightSidebar } from "@/components/RightSidebarContext";
import TicketQuickEdit from "@/components/TicketQuickEdit";
import { COMPACT_LAYOUT_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { useTranslation } from "react-i18next";

type RightSidebarProps = {
  userPermissions: Role["permissions"];
};

export default function RightSidebar({ userPermissions }: RightSidebarProps) {
  const { t } = useTranslation();
  const { isOpen, toggle, mobileOpen, setMobileOpen } = useRightSidebar();
  const asOverlay = useMediaQuery(COMPACT_LAYOUT_QUERY);
  const canViewTickets = userPermissions?.viewTickets || false;
  const canManageTickets = userPermissions?.manageTickets || false;

  if (!canViewTickets) {
    return null;
  }

  // Handy und Tablet (unter 1280 px): ueber dem Inhalt statt daneben - am Handy liess die 360 px
  // breite Leiste 48 px fuer den Inhalt, am Tablet 150-400 px. Geoeffnet ueber den Knopf in der Kopfzeile.
  if (asOverlay) {
    return (
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="right" className="flex w-[92vw] max-w-[360px] flex-col gap-0 p-0"
          aria-describedby={undefined}
          data-testid="sheet-right-sidebar"
        >
          <SheetHeader className="border-b border-border p-3 pr-12 text-left">
            <SheetTitle className="text-sm">{t("tickets.quickEdit.title")}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            <TicketQuickEdit canManageTickets={canManageTickets} canViewTickets={canViewTickets} />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      // passend zu COMPACT_LAYOUT_QUERY: erst ab xl neben dem Inhalt
      className={`hidden xl:block border-l border-border bg-background transition-all duration-200 ${
        isOpen ? "w-[360px]" : "w-12"
      }`}
    >
      <div className="flex items-center justify-between p-3 border-b border-border">
        {isOpen && (
          <div className="text-sm font-semibold">
            {t("tickets.quickEdit.title")}
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={t("tickets.quickEdit.title")}
          aria-expanded={isOpen}
          data-testid="button-toggle-right-sidebar"
        >
          {isOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
      {isOpen && (
        <div className="h-[calc(100%-48px)] overflow-auto">
          <TicketQuickEdit
            canManageTickets={canManageTickets}
            canViewTickets={canViewTickets}
          />
        </div>
      )}
    </aside>
  );
}
