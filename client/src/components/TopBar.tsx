import { Search, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface TopBarProps {
  userRole: "employee" | "admin";
  username: string;
  onSearchChange: (value: string) => void;
  searchValue: string;
}

export default function TopBar({ userRole, username, onSearchChange, searchValue }: TopBarProps) {
  return (
    <header className="h-16 border-b bg-card flex items-center justify-between px-6 gap-4">
      <div className="flex items-center gap-4 flex-1">
        <h1 className="text-xl font-semibold">METAorder</h1>
        
        <div className="relative w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search orders, customers..."
            className="pl-9"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            data-testid="input-search-orders"
          />
        </div>
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
