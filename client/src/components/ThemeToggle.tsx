import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useThemeMode } from "@/hooks/useThemeMode";

export default function ThemeToggle() {
  const { t } = useTranslation();
  const { mode, toggle } = useThemeMode();
  const label = mode === "light" ? t("theme.switchToDark") : t("theme.switchToLight");

  return (
    <Button variant="ghost" size="icon" onClick={toggle} data-testid="button-theme-toggle" aria-label={label} title={label}>
      {mode === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </Button>
  );
}
