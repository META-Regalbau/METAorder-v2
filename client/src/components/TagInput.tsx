import { X, Plus } from "lucide-react";
import { useState, KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface TagInputProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  suggestions?: string[];
  disabled?: boolean;
}

export default function TagInput({
  tags,
  onTagsChange,
  placeholder,
  maxTags = 10,
  suggestions = [],
  disabled = false,
}: TagInputProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleAddTag = (tag: string) => {
    const trimmedTag = tag.trim().toLowerCase();
    
    if (!trimmedTag) return;
    
    if (tags.length >= maxTags) {
      return;
    }
    
    if (tags.includes(trimmedTag)) {
      return;
    }
    
    onTagsChange([...tags, trimmedTag]);
    setInputValue("");
    setShowSuggestions(false);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onTagsChange(tags.filter(tag => tag !== tagToRemove));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      handleRemoveTag(tags[tags.length - 1]);
    }
  };

  const filteredSuggestions = suggestions
    .filter(s => !tags.includes(s) && s.toLowerCase().includes(inputValue.toLowerCase()))
    .slice(0, 5);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 min-h-[2.5rem] p-2 border rounded-md bg-background">
        {tags.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="gap-1"
            data-testid={`tag-badge-${tag}`}
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                className="hover-elevate rounded-sm"
                data-testid={`button-remove-tag-${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
        
        {!disabled && tags.length < maxTags && (
          <div className="flex-1 min-w-[120px] relative">
            <Input
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setShowSuggestions(e.target.value.length > 0);
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => setShowSuggestions(inputValue.length > 0)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder={placeholder || t('tickets.tagPlaceholder')}
              className="border-0 focus-visible:ring-0 h-7 px-2"
              data-testid="input-tag"
            />
            
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md z-50 max-h-[200px] overflow-auto">
                {filteredSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => handleAddTag(suggestion)}
                    className="w-full px-3 py-2 text-left text-sm hover-elevate"
                    data-testid={`suggestion-${suggestion}`}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      
      {!disabled && inputValue && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => handleAddTag(inputValue)}
          className="h-7"
          data-testid="button-add-tag"
        >
          <Plus className="h-4 w-4 mr-1" />
          {t('tickets.addTag')}
        </Button>
      )}
    </div>
  );
}
