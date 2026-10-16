import { describe, expect, it } from "vitest";
import {
  altIssue,
  CMS_IMAGE_ALT_TEXTS,
  collectCmsImageUsages,
  eanFromFileName,
  linkLabel,
  parseCmsLink,
  planCmsImageTexts,
  proposeMediaTexts,
  revertCmsImageTexts,
} from "../../server/products/cmsImageTexts";
import { PRODUCT_IMAGE_TEXTS_MARKER } from "../../server/products/productImageTexts";
import type { MediaTexts } from "../../server/shopware/client/media";

const CLIP = "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | Längsriegel | verzinkt";
const media = (over: Partial<MediaTexts> = {}): MediaTexts => ({
  id: "0194ef84959f714fbe03c759a0744f92",
  fileName: "4026212324259_200185364-blickhoehe",
  alt: "Ablage, Mobiliar, Krippe, Bett für Säuglinge",
  title: "4026212324259_200185364-blickhoehe",
  customFields: null,
  ...over,
});

describe("altIssue", () => {
  it.each([
    ["Ablage, Mobiliar, Krippe, Bett für Säuglinge", "Bilderkennung"],
    ["Ablage, Krippe, Mobiliar, Bett für Säuglinge", "Bilderkennung"],
    ["Handlauf, Gitarre, Musikinstrument, Handlauf, Gitarre, Musikinstrument", "Bilderkennung"],
    ["Ablage, Ablage", "Bilderkennung"],
    ["Ablage", "Bilderkennung"],
    ["", "leer"],
    [null, "leer"],
    ["4026212324259_200185364-blickhoehe", "Dateiname"],
  ])("%s → %s", (alt, issue) => {
    expect(altIssue(alt, "4026212324259_200185364-blickhoehe")).toBe(issue);
  });

  it("laesst von Hand gepflegte Texte stehen", () => {
    expect(altIssue("META MULTISTRONG MEDIUM Kragarmregal doppelseitig", "_8328_RGB")).toBeNull();
    expect(altIssue("Weitspannregal", "4026212057669_20051232-start")).toBeNull();
    expect(altIssue("CLIP Regal mit Schubladen und Türen", "01_META_CLIP_Steckregale-1024x1024")).toBeNull();
  });
});

describe("Vorschlaege", () => {
  it("EAN aus dem Dateinamen", () => {
    expect(eanFromFileName("4026212324259_200185364-blickhoehe")).toBe("4026212324259");
    expect(eanFromFileName("4026212275421_20097837-blickhoehe__38847.1713884740")).toBe("4026212275421");
    expect(eanFromFileName("Screenshot 2025-02-27 111132")).toBeNull();
  });

  it("Produktfoto: Name + Ansicht, TITLE statt Dateiname", () => {
    expect(proposeMediaTexts(media(), CLIP)).toEqual({
      alt: "META CLIP S3, Fachbodenregal, Grundregal, 2000 x 1000 x 500 mm, Fachlast 150 kg, 5 Ebenen, Längsriegel, verzinkt – Ansicht in Blickhöhe",
      title: CLIP,
      source: "Produkt 4026212324259 (Name + Ansicht aus Dateiname)",
    });
  });

  it("von Hand gepflegter TITLE bleibt", () => {
    expect(proposeMediaTexts(media({ title: "Mein Titel" }), CLIP)?.title).toBeNull();
  });

  it("hinterlegter Text vor Produktname, ohne Befund kein Vorschlag", () => {
    const id = "018ff2ce12e87d3dbfd143b7bdff919d";
    expect(proposeMediaTexts(media({ id, alt: "Ablage, Ablage" }), "MULTIPAL Anbauregal 2700 x 2700 x 1100 mm 3Lvl | 2970 kg")?.alt).toBe(CMS_IMAGE_ALT_TEXTS[id].alt);
    expect(proposeMediaTexts(media({ alt: "META CLIP Grundregal" }), CLIP)).toBeNull();
  });

  it("ohne Produkt und ohne hinterlegten Text kein Vorschlag", () => {
    expect(proposeMediaTexts(media({ id: "x".repeat(32), fileName: "IMG_1234", alt: null }), null)).toBeNull();
  });

  it("hinterlegte Texte nennen keine Wettbewerber und sind nicht leer", () => {
    for (const { alt, source } of Object.values(CMS_IMAGE_ALT_TEXTS)) {
      expect(alt.trim().length).toBeGreaterThan(10);
      expect(source.trim().length).toBeGreaterThan(5);
      expect(altIssue(alt, "")).toBeNull();
    }
  });
});

describe("Linktexte", () => {
  it("liest interne Links, Pfade und Filter", () => {
    expect(parseCmsLink("124c71d524604ccbad6042edce3ac799/navigation/018fcedb94cc7559b514582c15b84449#")).toEqual({ categoryId: "018fcedb94cc7559b514582c15b84449", path: null, propertyIds: [] });
    expect(parseCmsLink("/clip-grundregale?order=name-asc&p=1&properties=018fcf17ddee7988b23f52c6fdeac093")).toEqual({ categoryId: null, path: "clip-grundregale", propertyIds: ["018fcf17ddee7988b23f52c6fdeac093"] });
    expect(parseCmsLink("https://shop.meta-online.com/fachbodenregale/").path).toBe("fachbodenregale");
  });

  it("Ueberschrift nur, wenn das Ziel sie nicht schon nennt", () => {
    expect(linkLabel("CLIP Grundregale", "Grundregale")).toBe("CLIP Grundregale");
    expect(linkLabel("CLIP Grundregale", "Einzeilige Regale", ["Einfachregal"])).toBe("Einzeilige Regale – CLIP Grundregale (Einfachregal)");
    expect(linkLabel("MULTIPAL Anbauregale", "")).toBe("MULTIPAL Anbauregale");
  });

  it("findet Bilder in Kacheln samt Ueberschrift des folgenden Textblocks", () => {
    const page = {
      id: "p1",
      name: "DE - Alles zu Fachbodenregalen",
      sections: [
        {
          position: 4,
          customFields: { moorl_section_config: { salesChannel: ["c1"] } },
          blocks: [
            { position: 1, type: "text", slots: [{ id: "t1", slot: "content", type: "text", config: { content: { value: '<h2 style="text-align: center;">Grundregale</h2>' } } }] },
            { position: 0, type: "image-cover", slots: [{ id: "s1", slot: "image", type: "image", config: { media: { value: "0194ef84959f714fbe03c759a0744f92" }, url: { value: "/clip-grundregale" }, ariaLabel: { value: null } } }] },
            { position: 2, type: "image-slider", slots: [{ id: "s2", slot: "imageSlider", type: "image-slider", config: { sliderItems: { value: [{ mediaId: "0198cc6da49a7c299dca63240d5577ef", url: "https://shop.meta-online.com/x" }] } } }] },
          ],
        },
      ],
    };
    const usages = collectCmsImageUsages(page);
    expect(usages).toHaveLength(2);
    expect(usages[0]).toMatchObject({ slotId: "s1", block: 0, heading: "Grundregale", link: "/clip-grundregale", sectionChannels: ["c1"], ariaLabel: null });
    expect(usages[1]).toMatchObject({ slotId: "s2", element: "image-slider", heading: "" });
  });
});

describe("planCmsImageTexts", () => {
  const rows = [{ mediaId: "0194ef84959f714fbe03c759a0744f92", alt: "META CLIP S3 – Ansicht in Blickhöhe", title: CLIP }];
  const slotRows = [{ slotId: "s1", ariaLabel: "CLIP Grundregale" }];
  const slotConfig = { media: { source: "static", value: "0194ef84959f714fbe03c759a0744f92" }, url: { source: "static", value: "/clip-grundregale" }, ariaLabel: { source: "static", value: null } };

  it("schreibt ALT, TITLE und Markierung, haelt den alten Stand fest", () => {
    const plan = planCmsImageTexts(rows, slotRows, [media()], [{ id: "s1", config: slotConfig }]);
    expect(plan.mediaUpdates).toEqual([
      { id: rows[0].mediaId, alt: rows[0].alt, title: CLIP, customFields: { [PRODUCT_IMAGE_TEXTS_MARKER]: { alt: rows[0].alt, title: CLIP } } },
    ]);
    expect(plan.slotUpdates).toEqual([{ id: "s1", config: { ...slotConfig, ariaLabel: { source: "static", value: "CLIP Grundregale" } } }]);
    expect(plan.previous.media).toEqual([{ id: rows[0].mediaId, alt: media().alt, title: media().title, marker: null }]);
    expect(plan.previous.slots).toEqual([{ id: "s1", config: slotConfig }]);
    expect(slotConfig.ariaLabel.value).toBeNull(); // Original unveraendert
  });

  it("zweiter Lauf aendert nichts", () => {
    const first = planCmsImageTexts(rows, slotRows, [media()], [{ id: "s1", config: slotConfig }]);
    const u = first.mediaUpdates[0];
    const after = media({ alt: u.alt!, title: u.title!, customFields: u.customFields });
    const second = planCmsImageTexts(rows, slotRows, [after], [{ id: "s1", config: first.slotUpdates[0].config }]);
    expect(second.mediaUpdates).toEqual([]);
    expect(second.slotUpdates).toEqual([]);
    expect(second.unchanged).toBe(2);
  });

  it("leere Zeilen und fehlende Eintraege", () => {
    const plan = planCmsImageTexts([{ mediaId: "m0", alt: "  " }, { mediaId: "m1", alt: "x" }], [{ slotId: "s9", ariaLabel: "y" }], [], []);
    expect(plan.mediaUpdates).toEqual([]);
    expect(plan.missing).toEqual(["Medium m1", "Slot s9"]);
  });

  it("TITLE leer in der Liste: TITLE bleibt", () => {
    const plan = planCmsImageTexts([{ mediaId: rows[0].mediaId, alt: "neu", title: null }], [], [media()], []);
    expect(plan.mediaUpdates[0]).toEqual({ id: rows[0].mediaId, alt: "neu", customFields: { [PRODUCT_IMAGE_TEXTS_MARKER]: { alt: "neu" } } });
  });

  it("Revert stellt Texte, Markierung und Slot-Konfiguration wieder her", () => {
    const old = media({ customFields: { [PRODUCT_IMAGE_TEXTS_MARKER]: { alt: "vorher" }, other: 1 } });
    const plan = planCmsImageTexts(rows, slotRows, [old], [{ id: "s1", config: slotConfig }]);
    expect(revertCmsImageTexts(plan.previous)).toEqual({
      mediaUpdates: [{ id: old.id, alt: old.alt, title: old.title, customFields: { [PRODUCT_IMAGE_TEXTS_MARKER]: { alt: "vorher" } } }],
      slotUpdates: [{ id: "s1", config: slotConfig }],
    });
    const fresh = planCmsImageTexts(rows, [], [media()], []);
    expect(revertCmsImageTexts(fresh.previous).mediaUpdates[0].customFields).toEqual({ [PRODUCT_IMAGE_TEXTS_MARKER]: null });
  });
});
