import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertCircle, Lightbulb, Loader2, Send, Sparkles, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsInsight, AnalyticsQuery, AnalyticsResult, ImprovementSuggestion } from "@shared/schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import {
  formatNlValue,
  nlAlgorithmKey,
  nlChartPoints,
  nlDataKind,
  nlErrorCode,
  nlImprovementCategoryKey,
  nlLabel,
  nlQueryTypeKey,
  nlReliabilityKey,
  nlSummaryKind,
  nlTrendKey,
  nlView,
} from "@/lib/nlAnalytics";

type NlQueryResponse = {
  query: AnalyticsQuery;
  result: AnalyticsResult;
  insights: AnalyticsInsight[];
};

const EXAMPLE_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;
const TABLE_ROWS = 20;

/**
 * Reiter "Natürliche Sprache" der Statistik: Frage in Alltagssprache, der Server waehlt die
 * Auswertung (KI), rechnet sie auf dem Bestell-Spiegel und liefert Hinweise in der Oberflaechensprache.
 */
export default function NaturalLanguageAnalyticsTab() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language || "de").split("-")[0];
  const [question, setQuestion] = useState("");

  const ask = useMutation({
    mutationFn: async (q: string) => {
      const res = await apiRequest("POST", "/api/analytics/nl-query", { question: q, language });
      return (await res.json()) as NlQueryResponse;
    },
  });

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || ask.isPending) return;
    setQuestion(trimmed);
    ask.mutate(trimmed);
  };

  return (
    <div className="space-y-6" data-testid="nl-analytics">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {t("analytics.nlQuery.welcome")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t("analytics.nlQuery.welcomeDescription")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-start"
            onSubmit={(e) => {
              e.preventDefault();
              submit(question);
            }}
          >
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(question);
                }
              }}
              placeholder={t("analytics.nlQuery.inputPlaceholder")}
              aria-label={t("analytics.nlQuery.inputPlaceholder")}
              rows={2}
              className="flex-1"
              data-testid="input-nl-question"
            />
            <Button type="submit" disabled={!question.trim() || ask.isPending} data-testid="button-nl-ask">
              {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span className="ml-2">{t("analytics.nlQuery.ask")}</span>
            </Button>
          </form>
          <div>
            <div className="text-sm font-medium mb-2">{t("analytics.nlQuery.suggestedQuestions")}</div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_KEYS.map((key) => (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={ask.isPending}
                  onClick={() => submit(t(`analytics.nlQuery.examples.${key}`))}
                  data-testid={`button-nl-example-${key}`}
                >
                  {t(`analytics.nlQuery.examples.${key}`)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {ask.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-nl-analyzing">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("analytics.nlQuery.analyzing")}
        </div>
      )}

      {ask.isError && (
        <Alert variant="destructive" data-testid="alert-nl-error">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t("analytics.nlQuery.error")}</AlertTitle>
          <AlertDescription>{t(`analytics.nlQuery.errors.${nlErrorCode(ask.error)}`)}</AlertDescription>
        </Alert>
      )}

      {ask.data && !ask.isPending && <NlResult response={ask.data} locale={i18n.language || "de"} />}
    </div>
  );
}

function NlResult({ response, locale }: { response: NlQueryResponse; locale: string }) {
  const { t } = useTranslation();
  const { query, result, insights } = response;
  const type = query.type;
  const view = nlView(type);
  const summaryKind = nlSummaryKind(type);
  const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(locale) : null);
  const from = fmtDate(query.parameters.dateFrom);
  const to = fmtDate(query.parameters.dateTo);
  const summary = result.summary ?? {};
  const summaryTiles = (["total", "average", "min", "max"] as const).filter((k) => typeof summary[k] === "number");

  return (
    <Card data-testid="card-nl-result">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" data-testid="badge-nl-type">
            {t(nlQueryTypeKey(type), { defaultValue: type })}
          </Badge>
          {(from || to) && (
            <span className="text-sm text-muted-foreground">
              {t("analytics.nlQuery.period", { from: from ?? "…", to: to ?? "…" })}
            </span>
          )}
        </div>
        <CardTitle className="text-base font-medium">{query.naturalLanguageQuery}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {typeof summary.count === "number" && (
            <SummaryTile label={t("analytics.count")} value={formatNlValue(summary.count, "count", locale)} />
          )}
          {summaryTiles.map((k) => (
            <SummaryTile key={k} label={t(`analytics.${k}`)} value={formatNlValue(summary[k], summaryKind, locale)} />
          ))}
        </div>

        {result.labels.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-nl-no-data">{t("analytics.nlQuery.noData")}</p>
        ) : view === "table_delayed" ? (
          <DelayedOrdersTable rows={result.data as any[]} locale={locale} />
        ) : view === "table_customers" ? (
          <CustomersTable rows={result.data as any[]} locale={locale} />
        ) : (
          <NlChart response={response} locale={locale} />
        )}

        {result.forecast && <ForecastFacts result={result} />}
        {!result.forecast && nlTrendKey(result.metadata?.trend) && (
          <div className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4" />
            {t(nlTrendKey(result.metadata?.trend)!)}
          </div>
        )}

        {insights.length > 0 && (
          <div data-testid="list-nl-insights">
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              {t("analytics.nlQuery.insights")}
            </h3>
            <ul className="space-y-2">
              {insights.map((insight, i) => (
                <li key={i} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge variant="outline">{t(`analytics.nlQuery.insightTypes.${insight.type}`, { defaultValue: insight.type })}</Badge>
                    {typeof insight.confidence === "number" && (
                      <span className="text-xs text-muted-foreground">
                        {t("analytics.nlQuery.confidence")}: {insight.confidence}%
                      </span>
                    )}
                  </div>
                  {insight.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.improvements && result.improvements.length > 0 && <Improvements items={result.improvements} />}
      </CardContent>
    </Card>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function NlChart({ response, locale }: { response: NlQueryResponse; locale: string }) {
  const { t } = useTranslation();
  const { query, result } = response;
  const type = query.type;
  const points = nlChartPoints(t, type, result);
  const kind = nlDataKind(type, 1);
  const fmt = (v: unknown) => formatNlValue(v, kind, locale);

  if (nlView(type) === "line") {
    const isForecast = Boolean(result.forecast);
    return (
      <div data-testid="chart-nl">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(v) => fmt(v)} width={90} />
            <Tooltip formatter={(v) => fmt(v)} />
            <Legend />
            {isForecast ? (
              <>
                <Line type="monotone" dataKey="historical" name={t("analytics.nlQuery.forecast.historical")} stroke="#3b82f6" dot={false} />
                <Line type="monotone" dataKey="predicted" name={t("analytics.nlQuery.forecast.predicted")} stroke="#f59e0b" strokeDasharray="6 4" dot={false} />
                <Line type="monotone" dataKey="lower" name={t("analytics.nlQuery.forecast.lowerBound")} stroke="#9ca3af" strokeDasharray="2 4" dot={false} />
                <Line type="monotone" dataKey="upper" name={t("analytics.nlQuery.forecast.upperBound")} stroke="#9ca3af" strokeDasharray="2 4" dot={false} />
              </>
            ) : (
              <Line type="monotone" dataKey="value" name={t("analytics.value")} stroke="#3b82f6" dot={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Balken nur bei gleichartigen Werten; die allgemeinen Statistiken mischen Anzahl und Betraege
  const rows = points.slice(0, TABLE_ROWS);
  return (
    <div className="space-y-4" data-testid="chart-nl">
      {type !== "general_statistics" && (
        <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 28)}>
          <BarChart data={rows} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tickFormatter={(v) => fmt(v)} />
            <YAxis type="category" dataKey="label" width={220} />
            <Tooltip formatter={(v) => fmt(v)} />
            <Bar dataKey="value" name={t("analytics.value")} fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("analytics.nlQuery.name")}</TableHead>
            <TableHead className="text-right">{t("analytics.value")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.labels.slice(0, TABLE_ROWS).map((label, i) => (
            <TableRow key={`${label}-${i}`}>
              <TableCell>{nlLabel(t, type, label)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNlValue(result.data[i], nlDataKind(type, i), locale)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DelayedOrdersTable({ rows, locale }: { rows: any[]; locale: string }) {
  const { t } = useTranslation();
  return (
    <Table data-testid="table-nl-delayed">
      <TableHeader>
        <TableRow>
          <TableHead>{t("analytics.nlQuery.orderNumber")}</TableHead>
          <TableHead>{t("analytics.nlQuery.customer")}</TableHead>
          <TableHead>{t("analytics.nlQuery.status")}</TableHead>
          <TableHead className="text-right">{t("analytics.nlQuery.delayDays")}</TableHead>
          <TableHead className="text-right">{t("analytics.nlQuery.amount")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.slice(0, TABLE_ROWS).map((row) => (
          <TableRow key={row.orderNumber}>
            <TableCell>{row.orderNumber}</TableCell>
            <TableCell>{row.customerName}</TableCell>
            <TableCell>{t(`status.${row.status}`, { defaultValue: row.status })}</TableCell>
            <TableCell className="text-right tabular-nums">{row.daysDelayed}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNlValue(row.totalAmount, "currency", locale)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CustomersTable({ rows, locale }: { rows: any[]; locale: string }) {
  const { t } = useTranslation();
  const top = [...rows].sort((a, b) => (b.totalSpent ?? 0) - (a.totalSpent ?? 0)).slice(0, TABLE_ROWS);
  return (
    <Table data-testid="table-nl-customers">
      <TableHeader>
        <TableRow>
          <TableHead>{t("analytics.nlQuery.customer")}</TableHead>
          <TableHead className="text-right">{t("analytics.orderCount")}</TableHead>
          <TableHead className="text-right">{t("analytics.nlQuery.revenue")}</TableHead>
          <TableHead className="text-right">{t("analytics.average")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {top.map((row, i) => (
          <TableRow key={`${row.name}-${i}`}>
            <TableCell>{row.name}</TableCell>
            <TableCell className="text-right tabular-nums">{row.orderCount}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNlValue(row.totalSpent, "currency", locale)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNlValue(row.averageOrderValue, "currency", locale)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ForecastFacts({ result }: { result: AnalyticsResult }) {
  const { t } = useTranslation();
  const forecast = result.forecast!;
  const algorithmKey = nlAlgorithmKey(forecast.algorithm);
  const trendKey = nlTrendKey(result.metadata?.trend);
  return (
    <div className="grid gap-2 text-sm sm:grid-cols-2" data-testid="nl-forecast-facts">
      {forecast.algorithm && (
        <div>
          {t("analytics.nlQuery.forecast.algorithm")}: {algorithmKey ? t(algorithmKey) : forecast.algorithm}
        </div>
      )}
      {typeof forecast.accuracy === "number" && (
        <div>
          {t("analytics.nlQuery.forecast.accuracy")}: {Math.round(forecast.accuracy)}% ({t(nlReliabilityKey(forecast.accuracy))})
        </div>
      )}
      <div>
        {t("analytics.nlQuery.forecast.seasonality")}:{" "}
        {t(forecast.seasonalityDetected ? "analytics.nlQuery.forecast.detected" : "analytics.nlQuery.forecast.notDetected")}
      </div>
      <div>
        {forecast.periods} {t("analytics.nlQuery.forecast.periods")}
      </div>
      {trendKey && <div>{t(trendKey)}</div>}
    </div>
  );
}

function Improvements({ items }: { items: ImprovementSuggestion[] }) {
  const { t } = useTranslation();
  return (
    <div data-testid="list-nl-improvements">
      <h3 className="font-medium mb-2">{t("analytics.nlQuery.improvements.title")}</h3>
      <div className="space-y-3">
        {items.map((s) => (
          <div key={s.id} className="rounded-md border p-3 text-sm space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{s.title}</span>
              <Badge variant={s.priority === "high" ? "destructive" : "secondary"}>
                {t("analytics.nlQuery.improvements.priority")}: {t(`analytics.nlQuery.improvements.${s.priority}`, { defaultValue: s.priority })}
              </Badge>
              <Badge variant="outline">{t(nlImprovementCategoryKey(s.category), { defaultValue: s.category })}</Badge>
            </div>
            <p>{s.description}</p>
            {s.expectedImpact && (
              <p>
                <span className="text-muted-foreground">{t("analytics.nlQuery.improvements.expectedImpact")}:</span> {s.expectedImpact}
              </p>
            )}
            {s.actionItems && s.actionItems.length > 0 && (
              <div>
                <div className="text-muted-foreground">{t("analytics.nlQuery.improvements.actionItems")}:</div>
                <ul className="list-disc pl-5">
                  {s.actionItems.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {s.timeframe && (
              <p>
                <span className="text-muted-foreground">{t("analytics.nlQuery.improvements.timeframe")}:</span> {s.timeframe}
              </p>
            )}
            {s.basedOn && (
              <p>
                <span className="text-muted-foreground">{t("analytics.nlQuery.improvements.basedOn")}:</span> {s.basedOn}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
