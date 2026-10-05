import { apiErrorInfo, apiErrorText } from "./apiError";

/** Hinweis zu einem Fehler aus apiRequest; Mondu-Fehler beim Versand mit eigenem Titel. */
export function getApiErrorToastContent(
  error: Error,
  t: (key: string) => string,
  fallbackTitleKey = "errors.updateFailed",
): { title: string; description: string } {
  const info = apiErrorInfo(error);
  const body = (info?.body ?? null) as { error?: string; message?: string; code?: string } | null;
  if (body && (body.error === "Mondu plugin error" || body.code?.startsWith("mondu_ship"))) {
    const description =
      body.code === "mondu_ship_blocked_after_payment_switch"
        ? t("orders.monduPluginErrorPaymentSwitchDescription")
        : body.message || t("orders.monduPluginErrorDescription");
    return { title: t("orders.monduPluginError"), description };
  }
  // Meldung in der Sprache der Oberflaeche (ApiError.message bzw. aus dem alten Format "Status: Text")
  return { title: t(fallbackTitleKey), description: info ? apiErrorText(info) : error.message };
}
