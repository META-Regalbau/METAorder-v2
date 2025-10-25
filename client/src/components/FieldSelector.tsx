import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface FieldOption {
  field: string;
  label: string;
  description?: string;
  type?: string;
}

interface AvailableFields {
  standardFields: Array<{ field: string; label: string; description: string }>;
  customFields: Array<{ field: string; label: string; type: string }>;
}

interface FieldSelectorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testId?: string;
}

export default function FieldSelector({ value, onChange, placeholder, testId }: FieldSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Fetch available fields from API
  const { data: fieldsData, isLoading } = useQuery<AvailableFields>({
    queryKey: ['/api/cross-selling-rules/available-fields'],
  });

  // Combine all fields into single list with category
  const allFields: Array<FieldOption & { category: string }> = [
    ...(fieldsData?.standardFields || []).map(f => ({ ...f, category: 'standard' })),
    ...(fieldsData?.customFields || []).map(f => ({ ...f, category: 'custom' })),
  ];

  // Filter fields based on search
  const filteredFields = search
    ? allFields.filter(f =>
        f.field.toLowerCase().includes(search.toLowerCase()) ||
        f.label.toLowerCase().includes(search.toLowerCase())
      )
    : allFields;

  // Group filtered fields by category
  const standardFiltered = filteredFields.filter(f => f.category === 'standard');
  const customFiltered = filteredFields.filter(f => f.category === 'custom');

  // Find the label for the current value
  const selectedField = allFields.find(f => f.field === value);
  const displayValue = selectedField ? selectedField.label : value || placeholder || t('ruleBuilder.selectField');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          data-testid={testId}
        >
          <span className="truncate">{displayValue}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput 
            placeholder={t('ruleBuilder.searchFields')} 
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{t('ruleBuilder.noFieldsFound')}</CommandEmpty>
            
            {standardFiltered.length > 0 && (
              <CommandGroup heading={t('ruleBuilder.standardFields')}>
                {standardFiltered.map((field) => (
                  <CommandItem
                    key={field.field}
                    value={field.field}
                    onSelect={() => {
                      onChange(field.field);
                      setOpen(false);
                      setSearch("");
                    }}
                    data-testid={`field-option-${field.field}`}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === field.field ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{field.label}</span>
                      <span className="text-xs text-muted-foreground">{field.field}</span>
                      {field.description && (
                        <span className="text-xs text-muted-foreground">{field.description}</span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            
            {customFiltered.length > 0 && (
              <CommandGroup heading={t('ruleBuilder.customFields')}>
                {customFiltered.map((field) => (
                  <CommandItem
                    key={field.field}
                    value={field.field}
                    onSelect={() => {
                      onChange(field.field);
                      setOpen(false);
                      setSearch("");
                    }}
                    data-testid={`field-option-${field.field}`}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === field.field ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{field.label}</span>
                      <span className="text-xs text-muted-foreground">{field.field}</span>
                      {field.type && (
                        <span className="text-xs text-muted-foreground">Type: {field.type}</span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
