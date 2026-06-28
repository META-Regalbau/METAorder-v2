/** Liest strukturierte Fehler aus apiRequest (`502: {"message":"…"}`). */
export function getApiErrorToastContent(
  error: Error,
  t: (key: string) => string,
  fallbackTitleKey = "errors.updateFailed",
): { title: string; description: string } {
  const match = error.message.match(/^\d+:\s*([\s\S]+)$/);
  if (match) {
    try {
      const body = JSON.parse(match[1]) as {
        error?: string;
        message?: string;
        code?: string;
      };
      if (
        body.error === "Mondu plugin error" ||
        body.code?.startsWith("mondu_ship")
      ) {
        const description =
          body.code === "mondu_ship_blocked_after_payment_switch"
            ? t("orders.monduPluginErrorPaymentSwitchDescription")
            : body.message || t("orders.monduPluginErrorDescription");
        return {
          title: t("orders.monduPluginError"),
          description,
        };
      }
      if (body.message) {
        return { title: t(fallbackTitleKey), description: body.message };
      }
      if (body.error) {
        return { title: t(fallbackTitleKey), description: body.error };
      }
    } catch {
      // Rohtext beibehalten
    }
  }
  return { title: t(fallbackTitleKey), description: error.message };
}
