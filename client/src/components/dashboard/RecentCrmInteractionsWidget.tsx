import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { de, enUS, es } from "date-fns/locale";

type CrmInteraction = {
  id: string;
  customerId: string;
  customerName: string | null;
  customerEmail: string | null;
  userName: string | null;
  interactionType: string;
  subject: string;
  body: string;
  createdAt: string;
};

export default function RecentCrmInteractionsWidget() {
  const { t, i18n } = useTranslation();

  const { data: interactions = [], isLoading } = useQuery<CrmInteraction[]>({
    queryKey: ["/api/dashboard/crm-interactions"],
    retry: false,
  });

  const getDateFnsLocale = () => {
    switch (i18n.language) {
      case "de":
        return de;
      case "es":
        return es;
      default:
        return enUS;
    }
  };

  const truncateText = (text: string, maxLength = 100) =>
    text.length <= maxLength ? text : `${text.substring(0, maxLength)}...`;

  const getTypeLabel = (type: string) => {
    const key = `crm.interactions.types.${type}`;
    const translated = t(key);
    return translated === key ? type : translated;
  };

  return (
    <Card data-testid="widget-crm-interactions">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t("dashboard.recentCrmInteractions")}</CardTitle>
          </div>
          <Link href="/crm">
            <Button variant="ghost" size="sm" data-testid="button-view-all-crm">
              {t("common.viewAll")}
            </Button>
          </Link>
        </div>
        <CardDescription>{t("dashboard.recentCrmInteractionsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : interactions.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t("dashboard.noCrmInteractions")}</div>
        ) : (
          <div className="space-y-3">
            {interactions.slice(0, 10).map((interaction) => {
              const linkParams = new URLSearchParams();
              if (interaction.customerId) linkParams.set("customerId", interaction.customerId);
              if (interaction.customerEmail) linkParams.set("customerEmail", interaction.customerEmail);
              if (interaction.customerName) linkParams.set("customerName", interaction.customerName);
              const link = `/crm?${linkParams.toString()}`;

              return (
                <Link key={interaction.id} href={link}>
                  <div className="flex flex-col gap-2 p-3 border rounded-md hover-elevate active-elevate-2 cursor-pointer">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {interaction.customerName || interaction.customerEmail || t("common.unknown")}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {truncateText(interaction.subject || interaction.body || "")}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {getTypeLabel(interaction.interactionType)}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {interaction.userName || t("common.unknown")}
                        </span>
                        {interaction.customerEmail && (
                          <span className="text-xs text-muted-foreground">{interaction.customerEmail}</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(interaction.createdAt), {
                          addSuffix: true,
                          locale: getDateFnsLocale(),
                        })}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
