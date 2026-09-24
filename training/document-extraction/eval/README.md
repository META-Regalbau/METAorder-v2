# Eval-Datensatz für die Dokument-Extraktion

Misst, wie zuverlässig die Extraktion echte Bestellungen und Anfragen liest — feldweise,
damit sichtbar wird **wo** es hakt, nicht nur *dass*.

```bash
npm run eval:extraction
npm run eval:extraction -- --case=holme --json=/tmp/eval.json
```

Voraussetzung ist ein `OPENAI_API_KEY` (oder die Replit-Integration). Datenbank und
Shopware werden **nicht** gebraucht — bewertet wird ausschließlich die Extraktion.

## Wichtig: nicht mit den Few-Shots vermischen

Die Beispiele in [`../few-shot/`](../few-shot/) stehen **im Prompt**. Wer damit misst,
misst das Auswendiglernen und bekommt zu gute Zahlen. Dieser Ordner muss davon getrennt
bleiben — hier gehören nur Dokumente hinein, die das Modell im Prompt **nicht** sieht.

## Einen Fall anlegen

Zwei Dateien mit gleichem Namensstamm:

```
<name>.input.eml       # oder .txt, .pdf, .png, .jpg
<name>.expected.json   # Sollwert im DocumentExtraction-Schema
```

Der Sollwert folgt [`shared/documentExtractionSchema.ts`](../../../shared/documentExtractionSchema.ts).
Am schnellsten geht es so:

1. Dokument hochladen, Entwurf in der UI öffnen, **JSON kopieren** (Debug-Panel).
2. Den `documentExtraction`-Teil als `<name>.expected.json` speichern.
3. **Von Hand korrigieren** — das ist der eigentliche Arbeitsschritt. Ein ungeprüfter
   Sollwert misst nichts.

Felder, die im Dokument nicht vorkommen, gehören als `null` in den Sollwert. Der Vergleich
unterscheidet „nicht erkannt" (missing) von „erfunden" (spurious); ohne explizite `null`
lässt sich Halluzination nicht messen.

## Was bewertet wird

**Kopfdaten:** Belegart, Belegnummer, Datum, Liefertermin, Währung, Nettosumme,
Käufer (Firma, Straße, PLZ, Ort, Land, UID, Kundennummer, E-Mail), Lieferadresse.

**Positionen:** Menge, Lieferanten-Artikelnummer, Kunden-Artikelnummer, Einzelpreis —
zugeordnet über die **Positionsnummer**, nicht über den Index. Erzeugt die Extraktion eine
Zeile zu viel (typischer Fehler bei mehrzeiligen Tabellen), verrutscht deshalb nicht die
ganze Bewertung; die überzählige Zeile schlägt sich in „Positionsanzahl korrekt" nieder.

Freitext-Beschreibungen werden bewusst **nicht** streng verglichen — dort ist jede
Formulierung vertretbar, ein Exaktvergleich würde nur Rauschen erzeugen.

Vergleichsregeln: Groß-/Kleinschreibung und Mehrfach-Leerzeichen sind egal; bei
Artikelnummern auch Trennzeichen (`4032 9812345678` = `40329812345678`); Beträge mit
1-Cent-Toleranz; Mengen exakt.

## Zusammenstellung des Datensatzes

30–50 Fälle, die den realen Posteingang abbilden — nicht die einfachen:

- mehrzeilige Bestelltabellen (Positionsnummer in Zeile 1, Menge in Zeile 2)
- gescannte PDFs ohne Textebene (prüft den Vision-Pfad)
- Bestellungen ohne Positionsnummern
- Anfragen als reiner Mailtext ohne Anhang
- Firmendaten nur in der Signatur
- abweichende Lieferadresse
- fremdsprachige Belege

## Tests der Bewertungslogik

```bash
npm run test:extraction-eval
```

## Echte Fälle im Datensatz (Stand September 2026)

| Fall | Besonderheit |
|------|--------------|
| `real_hmf_multipal_bestellung` | EAN in jeder Positionszeile, 6-stellige META-Kurznummer in der Art.-Nr.-Spalte, abweichende Lieferanschrift, Avis-Kontakt |
| `real_cp_breidenbach_grundregal` | META-Nummer nur als „Lieferantenartikelnummer" unter der Position, Kundennummer in der Spalte, Kommission/Referenz, Lieferschein-Hinweis |
| `real_cordes_graefe_kragarmregal` | Ohne Preise, Kontakt als „Nachname Vorname", Lieferadresse = Besteller, Warenannahme-Hinweise |
| `real_roloff_palettenregal` | META-ERP-Nummern (2001…) in der „Nr."-Spalte, kundeneigene Nummern in „Unsere Art.-Nr.", Zeichensalat im Textlayer |
| `real_delker_schwerlastregal` | EAN als eigene Zeile „EAN: …", „Nummer beim Kunden" als Lieferschein-Pflichtangabe, Lieferkontakt im Positionstext, AB-/Rechnungsadresse |

Lauf nur für diese Fälle: `npm run eval:extraction -- --case=real_`
