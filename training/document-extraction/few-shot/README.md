# Few-Shot-Beispiele für die META-aware Dokument-Extraktion

Hier liegen Beispielpaare aus **PDF-Plaintext-Auszug** + **erwartetem JSON-Output**,
die bei jedem OpenAI-Aufruf in `orderDraftExtractor.ts` und `offerDraftExtractor.ts`
als Few-Shot-Boost in die Anfrage gehängt werden (Reihenfolge: System-Prompt →
alle Few-Shots als `user`/`assistant`-Paare → eigentliches Dokument).

## Dateinamenskonvention

Pro Beispiel **zwei** Dateien mit identischer ID:

```
<id>.input.txt        # Plaintext-Auszug aus dem PDF (max. ca. 2.500 Zeichen)
<id>.expected.json    # vollständiges erwartetes JSON gemäß documentExtractionSchema.ts
```

Beispiele werden beim ersten Aufruf des Extraktors einmal eingelesen und im Modul
gecacht — nach Änderungen also **App neu starten** (Container restart reicht).

## Was als Beispiel taugt

- Zwei häufigste Layouts der echten Bestellungen abdecken:
  - **mit Pos-Spalte + EAN/GTIN** (z. B. „BGtech-Stil")
  - **ohne Einheit-Spalte, Art.-Nr. inline in der Bezeichnung** (Hirtenfellner-Stil)
- **Lieferadresse innerhalb der Items-Tabelle** als erste „Zeile" — das Modell
  soll das nicht als Line Item interpretieren.
- Mehrzeilige Tabellenzellen (eine Position über 2–3 Textzeilen).
- Trunkierte Bezeichnungen (z. B. „Montage- und Gebrauchsanle") → erwartetes
  JSON enthält `"description_truncated"` in `confidence_warnings`.

Bei jeder Prompt-Änderung Test-Suite gegenlaufen lassen
(siehe `training/document-extraction/fixtures/` — folgt in Phase 5).

## Datenschutz

Achte beim Einchecken darauf, dass keine echten Kundendaten reinkommen:
- E-Mails, Telefonnummern, USt-IdNrn pseudonymisieren
- Realistische Strukturen behalten, aber Namen/Firmen anonymisieren
- Im Zweifel: Beispiel als `*.input.txt` lokal halten, nur Schema-Validität testen
