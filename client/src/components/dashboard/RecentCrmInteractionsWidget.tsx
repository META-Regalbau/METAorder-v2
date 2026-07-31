import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
    <div className="mcard" data-testid="widget-crm-interactions">
      <div className="mcard-head">
        <div>
          <div className="mcard-head-left">
            <MessageSquare className="h-5 w-5" />
            <h3 className="mcard-title">{t("dashboard.recentCrmInteractions")}</h3>
          </div>
          <p className="mcard-desc">{t("dashboard.recentCrmInteractionsDescription")}</p>
        </div>
        <Link href="/crm" className="mbtn ghost sm" data-testid="button-view-all-crm">
          {t("common.viewAll")}
        </Link>
      </div>
      <div className="mcard-body">
        {isLoading ? (
          <div className="mloading">{t("common.loading")}</div>
        ) : interactions.length === 0 ? (
          <div className="mempty">{t("dashboard.noCrmInteractions")}</div>
        ) : (
          <div className="mlist">
            {interactions.slice(0, 10).map((interaction) => {
              const linkParams = new URLSearchParams();
              if (interaction.customerId) linkParams.set("customerId", interaction.customerId);
              if (interaction.customerEmail) linkParams.set("customerEmail", interaction.customerEmail);
              if (interaction.customerName) linkParams.set("customerName", interaction.customerName);
              const link = `/crm?${linkParams.toString()}`;

              return (
                <Link key={interaction.id} href={link} className="mrow link">
                  <div className="mrow-main">
                    <div className="mrow-title">
                      <span className="truncate">
                        {interaction.customerName || interaction.customerEmail || t("common.unknown")}
                      </span>
                    </div>
                    <p className="mrow-snippet">
                      {truncateText(interaction.subject || interaction.body || "")}
                    </p>
                    <div className="mrow-badges">
                      <span className="mbadge b-outline">{getTypeLabel(interaction.interactionType)}</span>
                    </div>
                    <div className="mrow-meta">
                      <span>{interaction.userName || t("common.unknown")}</span>
                      {interaction.customerEmail && <span>{interaction.customerEmail}</span>}
                      <span>
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
      </div>
    </div>
  );
}
