import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import metaLogoUrl from "@assets/META-Logo.svg";

const PORTAL_URL = "https://portal.meta-online.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Öffentliche Seite /portal-zugang: Händler fordern mit Kundennummer und E-Mail
 * einen Link zum Festlegen ihres Händlerportal-Passworts an (Server: portalPasswordRequestRoutes).
 */
export default function PortalPasswordRequestPage() {
  const { t, i18n } = useTranslation();
  const [customerNumber, setCustomerNumber] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const requestMut = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/public/portal-password-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ customerNumber: customerNumber.trim(), email: email.trim(), website }),
      });
      if (res.status === 429) throw new Error(t("portalPassword.errorRateLimit"));
      if (!res.ok) throw new Error(t("portalPassword.errorGeneric"));
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!customerNumber.trim()) {
      setFieldError(t("portalPassword.customerNumberRequired"));
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setFieldError(t("portalPassword.emailInvalid"));
      return;
    }
    setFieldError(null);
    requestMut.mutate();
  };

  const language = (i18n.language || "de").split("-")[0];

  return (
    <main className="flex items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-end gap-1 mb-2" role="group" aria-label={t("portalPassword.language")}>
          {(["de", "en"] as const).map((lng) => (
            <Button
              key={lng}
              type="button"
              variant={language === lng ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={language === lng}
              onClick={() => void i18n.changeLanguage(lng)}
            >
              {lng.toUpperCase()}
            </Button>
          ))}
        </div>
        <img src={metaLogoUrl} alt="META" className="h-16 w-auto mx-auto mb-6" />
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">
              <h1>{t("portalPassword.title")}</h1>
            </CardTitle>
            <CardDescription className="text-center">{t("portalPassword.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {requestMut.isSuccess ? (
              <div className="space-y-4 text-center" role="status">
                <CheckCircle2 className="h-10 w-10 mx-auto text-green-600" aria-hidden="true" />
                <p className="font-medium">{t("portalPassword.successTitle")}</p>
                <p className="text-sm text-muted-foreground">{t("portalPassword.successText")}</p>
                <p className="text-sm text-muted-foreground">{t("portalPassword.changeHint")}</p>
                <Button asChild className="w-full">
                  <a href={PORTAL_URL}>{t("portalPassword.toPortal")}</a>
                </Button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="portal-customer-number">{t("portalPassword.customerNumber")}</Label>
                  <Input
                    id="portal-customer-number"
                    value={customerNumber}
                    onChange={(e) => setCustomerNumber(e.target.value)}
                    autoComplete="off"
                    inputMode="text"
                    placeholder={t("portalPassword.customerNumberPlaceholder")}
                    data-testid="input-portal-customer-number"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="portal-email">{t("portalPassword.email")}</Label>
                  <Input
                    id="portal-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder={t("portalPassword.emailPlaceholder")}
                    data-testid="input-portal-email"
                  />
                </div>
                {/* Honigtopf: für Menschen unsichtbar, Bots füllen es aus. */}
                <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
                  <label htmlFor="portal-website">Website</label>
                  <input
                    id="portal-website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </div>
                {(fieldError || requestMut.error) && (
                  <p className="text-sm text-destructive" role="alert">
                    {fieldError || (requestMut.error as Error).message}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">{t("portalPassword.changeHint")}</p>
                <Button type="submit" className="w-full" disabled={requestMut.isPending} data-testid="button-portal-password-submit">
                  {requestMut.isPending ? t("portalPassword.sending") : t("portalPassword.submit")}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground text-center mt-4">{t("portalPassword.help")}</p>
      </div>
    </main>
  );
}
