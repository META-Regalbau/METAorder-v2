import { User, Menu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface TopBarProps {
  userRole: "employee" | "admin";
  username: string;
}

export default function TopBar({ userRole, username }: TopBarProps) {
  return (
    <header className="h-16 border-b bg-card flex items-center justify-between px-6 gap-4 sticky top-0 z-50">
      <div className="flex items-center gap-4">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        <h1 className="text-xl font-semibold">METAorder</h1>
      </div>
      
      <div className="flex items-center gap-3">
        <Badge variant={userRole === "admin" ? "default" : "secondary"} data-testid="badge-user-role">
          {userRole === "admin" ? "Admin" : "Employee"}
        </Badge>
        <div className="flex items-center gap-2">
          <User className="h-4 w-4" />
          <span className="text-sm font-medium" data-testid="text-username">{username}</span>
        </div>
      </div>
    </header>
  );
}
