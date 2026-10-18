import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Database, Loader2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ApiError } from "@/lib/apiError";

/**
 * Pimcore-Verbindung (Einstellungen -> Integration): Adresse, Datahub-Konfiguration, Artikelklasse,
 * Feld der Artikelnummer und API-Key. Der Key wird verschluesselt gespeichert und nie zurueckgegeben.
 * Der Test zeigt, welche Klassen und Felder die Konfiguration freigibt, und einen Beispiel-Artikel
 * (server/integration/pimcoreConnection.ts).
 */

type ConnectionResponse = {
  configured: boolean;
  baseUrl: string;
  endpoint: string;
  productClass: string;
  productNumberField: string;
  hasApiKey: boolean;
};

type TestResult = {
  endpointUrl: string;
  introspection: boolean;
  classes: Array<{ name: string; listingField: string; fields: Array<{ name: string; type: string }> }>;
  product: {
    className: string;
    numberField: string;
    numberFieldFound: boolean | null;
    totalCount: number | null;
    sample: { id: string; number: string | null } | null;
  };
};

const CONNECTION_KEY = ["/api/settings/pimcore-connection"] as const;

export default function PimcoreConnectionSection() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();

  const { data: connection } = useQuery<ConnectionResponse>({ queryKey: CONNECTION_KEY });
  const configured = Boolean(connection?.configured);

  const [form, setForm] = useState({ baseUrl: "", endpoint: "", productClass: "", productNumberField: "" });
  const [apiKey, setApiKey] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<{ message: string; detail: string | null } | null>(null);
  useEffect(() => {
    if (connection) {
      setForm({
        baseUrl: connection.baseUrl,
        endpoint: connection.endpoint,
        productClass: connection.productClass,
        productNumberField: connection.productNumberField,
      });
    }
  }, [connection?.baseUrl, connection?.endpoint, connection?.productClass, connection?.productNumberField]);

  const setField = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const onError = (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/pimcore-connection", { ...form, apiKey });
      return res.json() as Promise<ConnectionResponse>;
    },
    onSuccess: (saved) => {
      setApiKey("");
      queryClient.setQueryData(CONNECTION_KEY, saved);
      toast({ title: t("settings.integration.pimcore.saved") });
    },
    onError,
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/pimcore-connection/test", { ...form, apiKey });
      return res.json() as Promise<TestResult>;
    },
    onMutate: () => {
      setTestResult(null);
      setTestError(null);
    },
    onSuccess: (result) => {
      setTestResult(result);
      toast({ title: t("settings.integration.pimcore.testOk") });
    },
    onError: (e: Error) => {
      const body = e instanceof ApiError ? (e.body as { detail?: unknown } | null) : null;
      setTestError({ message: e.message, detail: typeof body?.detail === "string" ? body.detail : null });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/settings/pimcore-connection");
      return res.json() as Promise<ConnectionResponse>;
    },
    onSuccess: (cleared) => {
      setApiKey("");
      setConfirmRemove(false);
      setTestResult(null);
      setTestError(null);
      queryClient.setQueryData(CONNECTION_KEY, cleared);
      toast({ title: t("settings.integration.pimcore.removed") });
    },
    onError,
  });

  const canSubmit = form.baseUrl.trim().length > 0 && (apiKey.trim().length > 0 || Boolean(connection?.hasApiKey));
  const product = testResult?.product;

  const textField = (field: keyof typeof form, id: string, placeholder: string) => (
    <div>
      <Label className="text-xs" htmlFor={id}>{t(`settings.integration.pimcore.${field}Label`)}</Label>
      <Input
        id={id}
        className="mt-1"
        placeholder={placeholder}
        value={form[field]}
        onChange={setField(field)}
        data-testid={`input-${id}`}
      />
    </div>
  );

  return (
    <Card className="p-6" data-testid="card-pimcore-connection">
      <div className="flex items-center gap-2 mb-2">
        <Database className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium uppercase tracking-wide">{t("settings.integration.pimcore.title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{t("settings.integration.pimcore.description")}</p>
      <p className="text-xs mb-4 flex items-center gap-1" data-testid="text-pimcore-connection-state">
        {configured ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            {t("settings.integration.pimcore.connectedTo", { url: connection?.baseUrl, endpoint: connection?.endpoint })}
          </>
        ) : (
          <span className="text-muted-foreground">{t("settings.integration.pimcore.notConnected")}</span>
        )}
      </p>

      <div className="grid gap-3 md:grid-cols-2 mb-3">
        <div>
          <Label className="text-xs" htmlFor="pimcore-base-url">{t("settings.integration.pimcore.baseUrlLabel")}</Label>
          <Input
            id="pimcore-base-url"
            className="mt-1"
            inputMode="url"
            placeholder="https://pim.example.com"
            value={form.baseUrl}
            onChange={setField("baseUrl")}
            data-testid="input-pimcore-base-url"
          />
        </div>
        {textField("endpoint", "pimcore-endpoint", "metaorder")}
        {textField("productClass", "pimcore-product-class", "Artikel")}
        {textField("productNumberField", "pimcore-number-field", "GTIN")}
        <div className="md:col-span-2">
          <Label className="text-xs" htmlFor="pimcore-api-key">{t("settings.integration.pimcore.keyLabel")}</Label>
          <Input
            id="pimcore-api-key"
            className="mt-1"
            type="password"
            autoComplete="new-password"
            placeholder={
              connection?.hasApiKey
                ? t("settings.integration.pimcore.keyPlaceholderStored")
                : t("settings.integration.pimcore.keyPlaceholderNew")
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            data-testid="input-pimcore-api-key"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-4">{t("settings.integration.pimcore.keyHint")}</p>

      <div className="flex flex-wrap gap-2 mb-2">
        <Button type="button" onClick={() => saveMutation.mutate()} disabled={!canSubmit || saveMutation.isPending} data-testid="button-pimcore-save">
          {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("common.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => testMutation.mutate()}
          disabled={!canSubmit || testMutation.isPending}
          data-testid="button-pimcore-test"
        >
          {testMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("settings.integration.pimcore.test")}
        </Button>
        {configured ? (
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirmRemove(true)} data-testid="button-pimcore-remove">
            {t("settings.integration.pimcore.remove")}
          </Button>
        ) : null}
      </div>

      {testError ? (
        <div className="mt-4 text-sm text-destructive" role="alert" data-testid="text-pimcore-test-error">
          <p className="flex items-start gap-2">
            <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {testError.message}
          </p>
          {testError.detail ? (
            <p className="mt-1 pl-6 text-xs text-muted-foreground break-words">
              {t("settings.integration.pimcore.pimcoreSays", { detail: testError.detail })}
            </p>
          ) : null}
        </div>
      ) : null}

      {testResult && product ? (
        <div className="mt-6 border-t pt-4 text-sm space-y-2" data-testid="pimcore-test-result">
          <p className="text-xs text-muted-foreground break-all">{testResult.endpointUrl}</p>
          <p data-testid="text-pimcore-product-count">
            {product.totalCount !== null
              ? t("settings.integration.pimcore.productCount", {
                  className: product.className,
                  count: product.totalCount,
                  formatted: fmt.integer(product.totalCount),
                })
              : t("settings.integration.pimcore.productCountUnknown", { className: product.className })}
          </p>
          {product.sample ? (
            <p className="text-xs text-muted-foreground" data-testid="text-pimcore-sample">
              {t("settings.integration.pimcore.sample", {
                id: product.sample.id,
                field: product.numberField,
                number: product.sample.number ?? "–",
              })}
            </p>
          ) : null}
          {product.numberFieldFound === false ? (
            <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400" data-testid="text-pimcore-field-missing">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t("settings.integration.pimcore.fieldMissing", { field: product.numberField, className: product.className })}
            </p>
          ) : null}
          {!testResult.introspection ? (
            <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400" data-testid="text-pimcore-no-introspection">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t("settings.integration.pimcore.noIntrospection")}
            </p>
          ) : (
            <div>
              <h3 className="text-sm font-medium mb-1">
                {t("settings.integration.pimcore.classesTitle", { count: testResult.classes.length })}
              </h3>
              <div className="space-y-1">
                {testResult.classes.map((cls) => (
                  <details key={cls.name} className="text-xs" data-testid={`pimcore-class-${cls.name}`}>
                    <summary className="cursor-pointer">
                      <span className="font-medium">{cls.name}</span>{" "}
                      <span className="text-muted-foreground">
                        {t("settings.integration.pimcore.fieldsCount", { count: cls.fields.length })}
                      </span>
                    </summary>
                    <ul className="mt-1 pl-5 columns-1 sm:columns-2 gap-6">
                      {cls.fields.map((field) => (
                        <li key={field.name} className="break-words">
                          {field.name} <span className="text-muted-foreground">{field.type}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.integration.pimcore.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.integration.pimcore.removeDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeMutation.mutate()} data-testid="button-pimcore-remove-confirm">
              {t("settings.integration.pimcore.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
