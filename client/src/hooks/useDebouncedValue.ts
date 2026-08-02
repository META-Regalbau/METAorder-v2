import { useEffect, useState } from "react";

/** Verzögert Wertänderungen um `delayMs` — für Query-Keys, die nicht bei jedem Tastendruck/Slider-Schritt feuern sollen. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
