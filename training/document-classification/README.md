# Belege für die Belegart-Erkennung (Lieferschein / Bestellung / AB / Rechnung)

Echte Kundenbelege (September 2026) als Regressionsfälle für
`server/commercialAttachmentClassifier.ts`. Test: `npm run test:attachment-classifier`
(ohne Datenbank, Shopware oder OpenAI — nur PDF-Textlayer).

| Datei | Erwartete Belegart | Warum im Datensatz |
|-------|--------------------|--------------------|
| `real_cp_lieferschein_1433099.pdf` | `delivery_note` | Kundenlieferschein, der der Sendung beizulegen ist; enthält „Ihre Bestellung" und wurde früher als zweite Bestellung mit Mengen 10/20 extrahiert |
| `real_cp_bestellung_381345.pdf` | `purchase_order` | Bestellung aus derselben Mail; Labels im Textlayer gestapelt („Bestell-Nr.: Datum: 381345/000") |
| `real_hmf_bestellung_26631.pdf` | `purchase_order` | Klassische Bestellung mit EAN je Position |
| `real_roloff_bestellung_112608258.pdf` | `purchase_order` | Enthält die Bitte um eine Auftragsbestätigung und wurde deshalb als AB fehlklassifiziert, bis Titel nur an Zeilenanfängen zählten |
| `real_delker_bestellung_21433803.pdf` | `purchase_order` | Enthält die Rechnungsadresse invoice@delker.com und wurde deshalb als Rechnung fehlklassifiziert |
| `real_cordes_bestellung_09473957.pdf` | `purchase_order` | Gesperrter Titel B E S T E L L U N G, keine Preise |

Neue Fälle: PDF hier ablegen und in `scripts/testCommercialAttachmentClassifier.ts` einen
`check(...)` mit erwarteter Belegart und Kennnummern ergänzen. Gerade Lieferscheine anderer
Kunden sind wertvoll — die Erkennung soll nicht an einem Layout hängen.
