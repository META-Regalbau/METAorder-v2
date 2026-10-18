/**
 * Shop-Puls: aus den Funden eines Prüflaufs Meldungen machen (rein, ohne Datenbank; Tests in
 * tests/unit/shopPulse.test.ts).
 *
 * - Je Fund-Schlüssel eine Meldung. Neuer Fund → neue Meldung; Fund von früher → dieselbe Zeile wieder
 *   offen (reopenCount + 1); offener Fund → zuletzt gesehen, Schwere und Belege aktualisieren.
 * - Fund verschwunden → Meldung erledigt. Nur Quellen, deren Prüfung vollständig lief, dürfen erledigen
 *   (ein gescheiterter Abruf ist kein „alles gut“).
 * - Sofort gemeldet wird nur „critical“, und nur einmal je Schwere: notifiedSeverity merkt sich, was
 *   schon berücksichtigt ist. In der Lernwoche und bei „ruhig gestellt“ wird die Schwere still
 *   berücksichtigt (kein Nachholen danach, die Meldung steht im Tagesbericht). Warnungen gehen nur in den
 *   Tagesbericht.
 * - Entwarnung nur für Meldungen, die wirklich per Nachricht rausgingen.
 */
import {
  SEVERITY_RANK,
  SHOP_PULSE_EVENT_CODES,
  type ShopPulseDetection,
  type ShopPulseSeverity,
  type ShopPulseSignal,
  type ShopPulseSource,
} from "@shared/shopPulse";

export type ShopPulseNoticeKind = "new" | "escalated" | "resolved";

export type ShopPulseNotice = { kind: ShopPulseNoticeKind; signal: ShopPulseSignal };

export type ReconcileResult = {
  inserts: ShopPulseSignal[];
  /** reopen: erledigte Meldung wieder geöffnet (Zähler in der Datenbank um eins erhöhen) */
  updates: Array<{ id: string; patch: Partial<ShopPulseSignal>; reopen?: true }>;
  notices: ShopPulseNotice[];
};

export type ReconcileOptions = {
  now: Date;
  /** Lernwoche: nichts senden */
  learning: boolean;
  /** Quellen, deren Prüfung vollständig lief (nur diese erledigen verschwundene Funde) */
  completeSources: ShopPulseSource[];
  /**
   * Schlüssel-Anfänge von Prüfungen, die in diesem Lauf vollständig liefen, auch wenn ihre Quelle sonst
   * unvollständig ist (z. B. Zahlarten jeden Takt, Artikel nur nachts): diese Meldungen dürfen erledigt werden.
   */
  completeKeyPrefixes?: string[];
  newId: () => string;
};

const rank = (s: ShopPulseSeverity | null | undefined) => (s ? SEVERITY_RANK[s] : 0);

export function isMuted(signal: Pick<ShopPulseSignal, "mutedUntil">, now: Date): boolean {
  return !!signal.mutedUntil && Date.parse(signal.mutedUntil) > now.getTime();
}

/**
 * Ob ein Fund jetzt eine Nachricht auslöst: kritisch und schlimmer als bisher berücksichtigt, nicht in der
 * Lernwoche, nicht ruhig gestellt. Liefert außerdem die neu berücksichtigte Schwere.
 */
function noticeFor(
  signal: ShopPulseSignal,
  opts: ReconcileOptions,
): { notify: boolean; notifiedSeverity: ShopPulseSeverity | null } {
  if (rank(signal.severity) <= rank(signal.notifiedSeverity)) return { notify: false, notifiedSeverity: signal.notifiedSeverity };
  const silent = opts.learning || isMuted(signal, opts.now) || signal.severity !== "critical";
  return { notify: !silent, notifiedSeverity: signal.severity };
}

export function reconcileSignals(existing: ShopPulseSignal[], detections: ShopPulseDetection[], opts: ReconcileOptions): ReconcileResult {
  const now = opts.now.toISOString();
  const byKey = new Map(existing.map((s) => [s.key, s]));
  const result: ReconcileResult = { inserts: [], updates: [], notices: [] };
  const seen = new Set<string>();

  for (const d of detections) {
    if (seen.has(d.key)) continue; // derselbe Schlüssel zweimal in einem Lauf: der erste zählt
    seen.add(d.key);
    const prev = byKey.get(d.key);
    const fresh = {
      source: d.source,
      code: d.code,
      severity: d.severity,
      params: d.params ?? {},
      evidence: d.evidence ?? {},
      lossPerHour: d.lossPerHour ?? null,
      lastSeenAt: now,
    };

    if (!prev) {
      const signal: ShopPulseSignal = {
        id: opts.newId(),
        key: d.key,
        status: "open",
        firstSeenAt: now,
        resolvedAt: null,
        resolvedBy: null,
        mutedUntil: null,
        notifiedAt: null,
        notifiedSeverity: null,
        ...fresh,
      };
      const n = noticeFor(signal, opts);
      signal.notifiedSeverity = n.notifiedSeverity;
      if (n.notify) signal.notifiedAt = now;
      result.inserts.push(signal);
      if (n.notify) result.notices.push({ kind: "new", signal });
      continue;
    }

    if (prev.status === "resolved") {
      // Neuer Vorfall in derselben Zeile: zählt wieder als neu
      const signal: ShopPulseSignal = {
        ...prev,
        ...fresh,
        status: "open",
        firstSeenAt: now,
        resolvedAt: null,
        resolvedBy: null,
        notifiedAt: null,
        notifiedSeverity: null,
      };
      const n = noticeFor(signal, opts);
      signal.notifiedSeverity = n.notifiedSeverity;
      if (n.notify) signal.notifiedAt = now;
      result.updates.push({
        id: prev.id,
        patch: {
          ...fresh,
          status: "open",
          firstSeenAt: now,
          resolvedAt: null,
          resolvedBy: null,
          notifiedAt: signal.notifiedAt,
          notifiedSeverity: signal.notifiedSeverity,
        },
        reopen: true,
      });
      if (n.notify) result.notices.push({ kind: "new", signal });
      continue;
    }

    const signal: ShopPulseSignal = { ...prev, ...fresh };
    const n = noticeFor(signal, opts);
    const patch: Partial<ShopPulseSignal> = { ...fresh };
    if (n.notifiedSeverity !== prev.notifiedSeverity) patch.notifiedSeverity = n.notifiedSeverity;
    if (n.notify) {
      patch.notifiedAt = now;
      signal.notifiedAt = now;
    }
    signal.notifiedSeverity = n.notifiedSeverity;
    result.updates.push({ id: prev.id, patch });
    if (n.notify) result.notices.push({ kind: prev.notifiedAt ? "escalated" : "new", signal });
  }

  const complete = new Set(opts.completeSources);
  const prefixes = opts.completeKeyPrefixes ?? [];
  const resolvable = (s: ShopPulseSignal) => complete.has(s.source) || prefixes.some((p) => s.key.startsWith(p));
  for (const prev of existing) {
    if (prev.status !== "open" || seen.has(prev.key) || !resolvable(prev)) continue;
    const signal: ShopPulseSignal = { ...prev, status: "resolved", resolvedAt: now, resolvedBy: null };
    result.updates.push({ id: prev.id, patch: { status: "resolved", resolvedAt: now, resolvedBy: null } });
    // Ereignisse (Preissprung) laufen einfach aus, das ist keine Entwarnung
    const event = SHOP_PULSE_EVENT_CODES.includes(prev.code);
    if (!event && prev.notifiedAt && prev.severity === "critical" && !opts.learning && !isMuted(prev, opts.now)) {
      result.notices.push({ kind: "resolved", signal });
    }
  }

  return result;
}

/** Reihenfolge für Seite und Tagesbericht: kritisch zuerst, dann geschätzter Verlust, dann neueste */
export function compareSignals(a: ShopPulseSignal, b: ShopPulseSignal): number {
  return (
    rank(b.severity) - rank(a.severity) ||
    (b.lossPerHour ?? 0) - (a.lossPerHour ?? 0) ||
    Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt)
  );
}

/** Offene, nicht ruhig gestellte Meldungen für den Tagesbericht */
export function dailyReportSignals(signals: ShopPulseSignal[], now: Date): ShopPulseSignal[] {
  return signals.filter((s) => s.status === "open" && !isMuted(s, now)).sort(compareSignals);
}
