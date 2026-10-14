import { describe, expect, it, vi } from "vitest";
import {
  buildImageTexts,
  isScheduledRunDue,
  looksLikeFileName,
  planImageTextUpdates,
  PRODUCT_IMAGE_TEXTS_MARKER,
  readableProductName,
  runProductImageTexts,
  sharedProductName,
  viewLabelFromFileName,
} from "../../server/products/productImageTexts";
import type { MediaTexts } from "../../server/shopware/client/media";

const NAME = "META CLIP S3 | Fachbodenregal | Anbauregal | 2000 x 1700 x 600 mm | Fachlast 200 kg | 4 Ebenen | verzinkt";

describe("viewLabelFromFileName", () => {
  it.each([
    ["4026212324051_200185252-blickhoehe.bb6ef588", "Ansicht in Blickhöhe"],
    ["4026212440102_9900013475-Blickhhe.d3803edb", "Ansicht in Blickhöhe"],
    ["4026212225020_20088808-frosch.6bf5ef15", "Ansicht von unten"],
    ["4026212285802_200177365-aufsicht.c37058c1", "Ansicht von oben"],
    ["4026212057959_20051261-seitlich.6f862286", "Seitenansicht"],
    ["4026212326116_200185491-ALT-blickhoehe.32100939", "Ansicht in Blickhöhe"],
    ["4026212128697_20076678_mU-blickhoehe.e31b0128", "Anwendungsbeispiel"],
    ["4026212075090_20059095-mU", "Anwendungsbeispiel"],
    ["4026212409987_9900008598-inhalt.895ec2ac", "mit Beispielbefüllung"],
    ["4026212417210_9900010095-Explo oben", "Explosionszeichnung"],
    ["4026212118568_20074924-einzel.e84fbcf9", "Detailansicht"],
    ["META_CLIP_Lochplattenhaken_Uebersicht.721c4012", "Übersicht"],
    ["Abdeckbodenträger-aufsicht.71b768c5", "Ansicht von oben"],
  ])("%s -> %s", (fileName, label) => {
    expect(viewLabelFromFileName(fileName)).toBe(label);
  });

  it.each([
    "4026212205206_20087042-vu.1238af1e",
    "4026212046281_2002366-pcon.bba28459",
    "4026212084702_20065869.7b2ac7aa",
    "Spanplatte_mit_AbgTiefenauflage.fbf53d16",
    "META MULTIPAL Holme",
  ])("ohne erkennbare Ansicht: %s", (fileName) => {
    expect(viewLabelFromFileName(fileName)).toBeNull();
  });
});

describe("Texte", () => {
  it("ALT lesbar mit Ansicht, TITLE = Produktname", () => {
    expect(buildImageTexts(NAME, "4026212324051_200185252-frosch.63bb9c93")).toEqual({
      alt: "META CLIP S3, Fachbodenregal, Anbauregal, 2000 x 1700 x 600 mm, Fachlast 200 kg, 4 Ebenen, verzinkt – Ansicht von unten",
      title: NAME,
    });
  });

  it("ohne Ansicht nur der Name", () => {
    expect(buildImageTexts("MSN Fachteiler  Tiefe 400 vzk", "4026212075090_20059095.abcdef12").alt).toBe("MSN Fachteiler Tiefe 400 vzk");
  });

  it("TITLE wird auf 255 Zeichen gekuerzt", () => {
    const title = buildImageTexts(`${"Regal ".repeat(60)}Ende`, "x").title;
    expect(title.length).toBeLessThanOrEqual(255);
    expect(title.endsWith("…")).toBe(true);
  });

  it("readableProductName entfernt Trennstriche am Rand", () => {
    expect(readableProductName("| META CLIP | Fachboden |")).toBe("META CLIP, Fachboden");
  });

  it("geteiltes Bild: gemeinsame Namensteile", () => {
    expect(
      sharedProductName([
        "META CLIP | Schubladen-Trennblech | 100 x 51 mm | verzinkt",
        "META CLIP | Schubladen-Trennblech | 200 x 225 mm | verzinkt",
      ]),
    ).toBe("META CLIP | Schubladen-Trennblech | verzinkt");
  });

  it("geteiltes Bild: neues Namensschema vor altem", () => {
    expect(
      sharedProductName([
        "MSN Fachteiler Höhe 200 x Tiefe 400 vzk ( 140 x 370 ) durchgehend",
        "META CLIP | Fachteiler durchgehend | 200 x 400 mm | verzinkt | 10 Stück",
      ]),
    ).toBe("META CLIP | Fachteiler durchgehend | 200 x 400 mm | verzinkt | 10 Stück");
  });

  it("Dateiname als TITLE erkennen (Shopware entfernt Umlaute im Dateinamen)", () => {
    expect(looksLikeFileName("4026212440102_9900013475-Blickhöhe.d3803edb", "4026212440102_9900013475-Blickhhe.d3803edb")).toBe(true);
    expect(looksLikeFileName("4026212440102_9900013475-blickhoehe.png", "4026212440102_9900013475-blickhoehe")).toBe(true);
    expect(looksLikeFileName("Fachbodenregal", "4026212440102_9900013475-blickhoehe")).toBe(false);
  });
});

function media(partial: Partial<MediaTexts> & { id: string }): MediaTexts {
  return { fileName: `${partial.id}-blickhoehe.12345678`, alt: null, title: null, customFields: null, ...partial };
}

const products = [{ id: "p1", productNumber: "4026212324051", name: NAME }];

describe("planImageTextUpdates", () => {
  it("leere Felder und Dateinamen-TITLE werden gefuellt, mit Markierung", () => {
    const m = media({ id: "m1", title: "m1-blickhoehe.12345678" });
    const plan = planImageTextUpdates([{ productId: "p1", mediaId: "m1", position: 0 }], products, [m]);
    expect(plan.updates).toHaveLength(1);
    const update = plan.updates[0];
    expect(update.alt).toContain("– Ansicht in Blickhöhe");
    expect(update.title).toBe(NAME);
    expect(update.customFields[PRODUCT_IMAGE_TEXTS_MARKER]).toEqual({ alt: update.alt, title: update.title });
    expect(plan.altChanges).toBe(1);
    expect(plan.titleChanges).toBe(1);
  });

  it("von Hand gepflegte Texte bleiben stehen", () => {
    const m = media({ id: "m1", alt: "Eigener ALT", title: "Eigener Titel" });
    const plan = planImageTextUpdates([{ productId: "p1", mediaId: "m1", position: 0 }], products, [m]);
    expect(plan.updates).toHaveLength(0);
    expect(plan.keptManualAlt).toBe(1);
    expect(plan.keptManualTitle).toBe(1);
  });

  it("nur ALT von Hand: TITLE wird trotzdem gesetzt, ALT bleibt", () => {
    const m = media({ id: "m1", alt: "Eigener ALT" });
    const [update] = planImageTextUpdates([{ productId: "p1", mediaId: "m1", position: 0 }], products, [m]).updates;
    expect(update.alt).toBeUndefined();
    expect(update.title).toBe(NAME);
    expect(update.customFields[PRODUCT_IMAGE_TEXTS_MARKER]).toEqual({ title: NAME });
  });

  it("eigener frueherer Text wird nach Umbenennung erneuert", () => {
    const old = buildImageTexts("Alter Name", "m1-blickhoehe.12345678");
    const m = media({ id: "m1", ...old, customFields: { [PRODUCT_IMAGE_TEXTS_MARKER]: old, other: 1 } });
    const plan = planImageTextUpdates([{ productId: "p1", mediaId: "m1", position: 0 }], products, [m]);
    expect(plan.updates[0].title).toBe(NAME);
    expect(plan.updates[0].alt).toContain("META CLIP S3");
  });

  it("unveraendert, wenn die Texte schon stimmen", () => {
    const texts = buildImageTexts(NAME, "m1-blickhoehe.12345678");
    const m = media({ id: "m1", ...texts, customFields: { [PRODUCT_IMAGE_TEXTS_MARKER]: texts } });
    const plan = planImageTextUpdates([{ productId: "p1", mediaId: "m1", position: 0 }], products, [m]);
    expect(plan.updates).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
  });

  it("replaceExistingAlt ersetzt alten ALT ohne Markierung, TITLE von Hand bleibt", () => {
    const m = media({ id: "m1", alt: "Ablage, Krippe, Mobiliar", title: "Eigener Titel" });
    const plan = planImageTextUpdates([{ productId: "p1", mediaId: "m1", position: 0 }], products, [m], { replaceExistingAlt: true });
    expect(plan.updates[0].alt).toContain("META CLIP S3");
    expect(plan.updates[0].title).toBeUndefined();
  });

  it("Bilder ohne Produkt werden ignoriert", () => {
    const plan = planImageTextUpdates([], products, [media({ id: "m1" })]);
    expect(plan.images).toBe(0);
    expect(plan.updates).toHaveLength(0);
  });
});

describe("runProductImageTexts", () => {
  const client = () => ({
    fetchProductImageLinks: vi.fn().mockResolvedValue([{ productId: "p1", mediaId: "m1", position: 0 }]),
    fetchProductImageProducts: vi.fn().mockResolvedValue(products),
    fetchMediaTexts: vi.fn().mockResolvedValue([media({ id: "m1" })]),
    syncMediaTexts: vi.fn().mockResolvedValue(undefined),
  });

  it("Testlauf schreibt nichts", async () => {
    const c = client();
    const summary = await runProductImageTexts(c, { dryRun: true, trigger: "manual" });
    expect(c.syncMediaTexts).not.toHaveBeenCalled();
    expect(summary.changed).toBe(1);
    expect(summary.examples[0].alt).toContain("Blickhöhe");
  });

  it("Schreiblauf uebergibt die Aenderungen", async () => {
    const c = client();
    await runProductImageTexts(c, { dryRun: false, trigger: "scheduled" });
    expect(c.fetchMediaTexts).toHaveBeenCalledWith(["m1"]);
    expect(c.syncMediaTexts).toHaveBeenCalledTimes(1);
    expect(c.syncMediaTexts.mock.calls[0][0][0].id).toBe("m1");
  });
});

describe("isScheduledRunDue", () => {
  // 14.10.2026 03:30 in Berlin (Sommerzeit) = 01:30 UTC
  const now = new Date("2026-10-14T01:30:00Z");
  it("faellig ab der eingestellten Stunde, einmal je Tag", () => {
    expect(isScheduledRunDue(now, { enabled: true, hourLocal: 3 }, {})).toBe(true);
    expect(isScheduledRunDue(now, { enabled: true, hourLocal: 4 }, {})).toBe(false);
    expect(isScheduledRunDue(now, { enabled: true, hourLocal: 3 }, { lastScheduledDay: "2026-10-14" })).toBe(false);
    expect(isScheduledRunDue(now, { enabled: false, hourLocal: 3 }, {})).toBe(false);
  });
});
