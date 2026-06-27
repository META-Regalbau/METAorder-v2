import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Category {
  id: string;
  name: string;
  parentId: string | null;
}

interface CategoryMultiSelectProps {
  value: string[];
  onChange: (categoryIds: string[]) => void;
  className?: string;
}

export function CategoryMultiSelect({ value, onChange, className }: CategoryMultiSelectProps) {
  const { t } = useTranslation();

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const handleToggle = (categoryId: string) => {
    if (value.includes(categoryId)) {
      onChange(value.filter((id) => id !== categoryId));
    } else {
      onChange([...value, categoryId]);
    }
  };

  const handleSelectAll = () => {
    onChange(categories.map((category) => category.id));
  };

  const handleClearAll = () => {
    onChange([]);
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  if (categories.length === 0) {
    return <div className="text-sm text-muted-foreground">{t("categories.none")}</div>;
  }

  const selected = categories.filter((category) => value.includes(category.id));

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {value.length === 0 ? t("categories.noneSelected") : t("categories.selectedCount", { count: value.length })}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={handleSelectAll} className="text-xs text-primary hover:underline">
            {t("categories.selectAll")}
          </button>
          <button type="button" onClick={handleClearAll} className="text-xs text-primary hover:underline">
            {t("categories.clearAll")}
          </button>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((category) => (
            <Badge key={category.id} variant="secondary">
              {category.name}
            </Badge>
          ))}
        </div>
      )}

      <ScrollArea className="h-48 rounded-md border p-2">
        <div className="space-y-1">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => handleToggle(category.id)}
              className={cn(
                "w-full flex items-center justify-between p-2 rounded-md text-sm hover-elevate active-elevate-2",
                value.includes(category.id) ? "bg-accent" : ""
              )}
            >
              <span className="truncate">{category.name}</span>
              {value.includes(category.id) && <Check className="h-4 w-4 flex-shrink-0" />}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
