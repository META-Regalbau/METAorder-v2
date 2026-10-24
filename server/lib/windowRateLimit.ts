/**
 * Zähler je Schlüssel und Zeitfenster im Speicher, mit Obergrenze für die Zahl der Schlüssel.
 *
 * Öffentliche Endpunkte zählen nach Werten, die der Aufrufer bestimmt (IP, Token-Anfang, Header). Ohne
 * Aufräumen wuchs die Liste mit jedem neuen Wert für immer – genug Anfragen mit zufälligen Werten hätten den
 * Speicher gefüllt. Abgelaufene Einträge werden deshalb entfernt; ist die Liste trotzdem voll, gilt ein neuer
 * Schlüssel als „zu viele Anfragen“ (die bekannten Schlüssel zählen normal weiter).
 */
export type WindowRateLimiter = {
  /** true, wenn die Anfrage im Rahmen liegt (und zählt sie) */
  hit(key: string, now?: number): boolean;
  /** Anzahl gespeicherter Schlüssel (für Tests) */
  size(): number;
};

export function createWindowRateLimiter(opts: { windowMs: number; max: number; maxKeys: number }): WindowRateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = 0;

  const sweep = (now: number) => {
    for (const [key, b] of buckets) if (now > b.resetAt) buckets.delete(key);
    nextSweep = now + opts.windowMs;
  };

  return {
    hit(key: string, now = Date.now()): boolean {
      if (now >= nextSweep) sweep(now);
      const b = buckets.get(key);
      if (b && now <= b.resetAt) {
        b.count += 1;
        return b.count <= opts.max;
      }
      if (!b && buckets.size >= opts.maxKeys) {
        sweep(now);
        if (buckets.size >= opts.maxKeys) return false;
      }
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return 1 <= opts.max;
    },
    size: () => buckets.size,
  };
}
