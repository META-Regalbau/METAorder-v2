import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Fehler beim Rendern einer Seite abfangen.
 *
 * Ohne Boundary reisst React bei einer Exception im Render oder in einem
 * Effect-Cleanup den kompletten Baum ab — die App zeigt dann eine weisse Seite
 * und nur ein Reload hilft. Hier bleiben Sidebar und TopBar stehen; nur der
 * Seiteninhalt wird durch eine Meldung mit "Erneut versuchen" ersetzt.
 */
function RouteErrorFallback({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  const { t } = useTranslation();
  const detail = error?.message?.trim();

  return (
    <Card className="mx-auto max-w-2xl" data-testid="route-error-boundary">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          {t("errorBoundary.title")}
        </CardTitle>
        <CardDescription>{t("errorBoundary.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {detail ? (
          <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
            {detail}
          </pre>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onRetry} data-testid="route-error-retry">
            <RotateCcw className="mr-2 h-4 w-4" />
            {t("errorBoundary.retry")}
          </Button>
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("errorBoundary.reload")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type Props = {
  children: ReactNode;
  /** Wechselt der Wert (z. B. der Pfad), wird ein bestehender Fehler verworfen. */
  resetKey?: string;
};

type State = { error: Error | null };

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[RouteErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    // Navigation zu einer anderen Seite: Fehler nicht mitschleppen
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <RouteErrorFallback
          error={this.state.error}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

export default RouteErrorBoundary;
