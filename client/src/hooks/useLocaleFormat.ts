import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { createLocaleFormatters } from "@/lib/localeFormat";

/** Formate (Betrag, Zahl, Prozent, Datum) in der aktuellen Sprache der Oberflaeche; wechselt mit ihr. */
export function useLocaleFormat() {
  const { i18n } = useTranslation();
  return useMemo(() => createLocaleFormatters(i18n.language), [i18n.language]);
}
