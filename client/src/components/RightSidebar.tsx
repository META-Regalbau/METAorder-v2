import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Role } from "@shared/schema";
import { useRightSidebar } from "@/components/RightSidebarContext";
import TicketQuickEdit from "@/components/TicketQuickEdit";
import { useTranslation } from "react-i18next";

type RightSidebarProps = {
  userPermissions: Role["permissions"];
};

export default function RightSidebar({ userPermissions }: RightSidebarProps) {
  const { t } = useTranslation();
  const { isOpen, toggle } = useRightSidebar();
  const canViewTickets = userPermissions?.viewTickets || false;
  const canManageTickets = userPermissions?.manageTickets || false;

  if (!canViewTickets) {
    return null;
  }

  return (
    <aside
      className={`border-l border-border bg-background transition-all duration-200 ${
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
