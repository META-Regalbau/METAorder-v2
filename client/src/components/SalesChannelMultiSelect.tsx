import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { SalesChannel } from "@shared/schema";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SalesChannelMultiSelectProps {
  value: string[];
  onChange: (channelIds: string[]) => void;
  className?: string;
}

export function SalesChannelMultiSelect({
  value,
  onChange,
  className,
}: SalesChannelMultiSelectProps) {
  const { t } = useTranslation();

  const { data: allChannels = [], isLoading } = useQuery<SalesChannel[]>({
    queryKey: ['/api/sales-channels'],
  });

  const handleToggleChannel = (channelId: string) => {
    if (value.includes(channelId)) {
      onChange(value.filter(id => id !== channelId));
    } else {
      onChange([...value, channelId]);
    }
  };

  const handleSelectAll = () => {
    onChange(allChannels.map(c => c.id));
  };

  const handleClearAll = () => {
    onChange([]);
  };

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  if (allChannels.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        {t('users.noSalesChannels')}
      </div>
    );
  }

  const selectedChannels = allChannels.filter(c => value.includes(c.id));

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {value.length === 0 && t('users.allChannelsAccess')}
          {value.length > 0 && t('users.selectedChannelsCount', { count: value.length })}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSelectAll}
            className="text-xs text-primary hover:underline"
            data-testid="button-select-all-sales-channels"
          >
            {t('salesChannel.selectAll')}
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="text-xs text-primary hover:underline"
            data-testid="button-clear-all-sales-channels"
          >
            {t('salesChannel.clearAll')}
          </button>
        </div>
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedChannels.map(channel => (
            <Badge
              key={channel.id}
              variant="secondary"
              className="gap-1"
              data-testid={`badge-selected-channel-${channel.id}`}
            >
              {channel.name}
            </Badge>
          ))}
        </div>
      )}

      <ScrollArea className="h-48 rounded-md border p-2">
        <div className="space-y-1">
          {allChannels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => handleToggleChannel(channel.id)}
              data-testid={`button-toggle-channel-${channel.id}`}
              className={cn(
                "w-full flex items-center justify-between p-2 rounded-md text-sm hover-elevate active-elevate-2",
                value.includes(channel.id) ? "bg-accent" : ""
              )}
            >
              <span className="truncate">{channel.name}</span>
              {value.includes(channel.id) && (
                <Check className="h-4 w-4 flex-shrink-0" />
              )}
            </button>
          ))}
        </div>
      </ScrollArea>

      <p className="text-xs text-muted-foreground">
        {t('users.salesChannelHelp')}
      </p>
    </div>
  );
}
