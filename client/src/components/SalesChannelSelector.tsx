import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { SalesChannel } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

interface SalesChannelSelectorProps {
  selectedChannelIds: string[];
  onSelectionChange: (channelIds: string[]) => void;
  userAllowedChannelIds?: string[] | null;
  isAdmin?: boolean;
}

export function SalesChannelSelector({
  selectedChannelIds,
  onSelectionChange,
  userAllowedChannelIds,
  isAdmin = false,
}: SalesChannelSelectorProps) {
  const { t } = useTranslation();

  const { data: allChannels = [], isLoading } = useQuery<SalesChannel[]>({
    queryKey: ['/api/sales-channels'],
  });

  // Determine which channels the user can see
  const availableChannels = isAdmin
    ? allChannels
    : allChannels.filter(channel =>
        !userAllowedChannelIds || userAllowedChannelIds.includes(channel.id)
      );

  const handleToggleChannel = (channelId: string) => {
    if (selectedChannelIds.includes(channelId)) {
      onSelectionChange(selectedChannelIds.filter(id => id !== channelId));
    } else {
      onSelectionChange([...selectedChannelIds, channelId]);
    }
  };

  const handleSelectAll = () => {
    onSelectionChange(availableChannels.map(c => c.id));
  };

  const handleClearAll = () => {
    onSelectionChange([]);
  };

  if (isLoading || availableChannels.length === 0) {
    return null;
  }

  const selectedCount = selectedChannelIds.length;
  const totalCount = availableChannels.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="default"
          data-testid="button-sales-channel-filter"
          className="gap-2"
        >
          <Filter className="h-4 w-4" />
          {t('salesChannel.filter')}
          {selectedCount > 0 && selectedCount < totalCount && (
            <Badge variant="secondary" className="ml-1">
              {selectedCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">{t('salesChannel.selectChannels')}</h4>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
                data-testid="button-select-all-channels"
                disabled={selectedCount === totalCount}
              >
                {t('salesChannel.selectAll')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                data-testid="button-clear-all-channels"
                disabled={selectedCount === 0}
              >
                {t('salesChannel.clearAll')}
              </Button>
            </div>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {availableChannels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => handleToggleChannel(channel.id)}
                data-testid={`button-toggle-channel-${channel.id}`}
                className={cn(
                  "w-full flex items-center justify-between p-2 rounded-md text-sm hover-elevate active-elevate-2",
                  selectedChannelIds.includes(channel.id)
                    ? "bg-accent"
                    : ""
                )}
              >
                <span className="truncate">{channel.name}</span>
                {selectedChannelIds.includes(channel.id) && (
                  <Check className="h-4 w-4 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
