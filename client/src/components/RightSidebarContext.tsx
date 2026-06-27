import { createContext, useContext, useEffect, useMemo, useState } from "react";

type RightSidebarContextValue = {
  isOpen: boolean;
  toggle: () => void;
  setIsOpen: (value: boolean) => void;
  activeTicketId: string | null;
  setActiveTicketId: (id: string | null) => void;
};

const RightSidebarContext = createContext<RightSidebarContextValue | undefined>(undefined);

const STORAGE_KEY = "metaorder-right-sidebar";

export function RightSidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(true);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.isOpen === "boolean") {
          setIsOpen(parsed.isOpen);
        }
      }
    } catch (error) {
      console.error("Failed to load sidebar state:", error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ isOpen }));
    } catch (error) {
      console.error("Failed to save sidebar state:", error);
    }
  }, [isOpen]);

  const value = useMemo(
    () => ({
      isOpen,
      toggle: () => setIsOpen((prev) => !prev),
      setIsOpen,
      activeTicketId,
      setActiveTicketId,
    }),
    [isOpen, activeTicketId]
  );

  return (
    <RightSidebarContext.Provider value={value}>
      {children}
    </RightSidebarContext.Provider>
  );
}

export function useRightSidebar() {
  const context = useContext(RightSidebarContext);
  if (!context) {
    throw new Error("useRightSidebar must be used within RightSidebarProvider");
  }
  return context;
}
