import { readFileSync } from "fs";
import path from "path";
import vm from "vm";
import { describe, expect, it } from "vitest";

// Das Storefront-Skript ist reines Browser-JS ohne Module; ohne window liefert es nur die reinen Helfer.
const source = readFileSync(path.resolve(import.meta.dirname, "../../shopware/storefront-snippets/checkout-cross-selling.js"), "utf8");
const context: Record<string, any> = {};
vm.runInNewContext(source, context);
const { pick, normalize, config } = context.MetaCheckoutCrossSelling as {
  pick: (lists: Array<Array<{ id: string }>>, exclude: string[], max: number) => Array<{ id: string }>;
  normalize: (text: string) => string;
  config: { tabTitles: string[]; salesChannelIds: string[] };
};
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);
const list = (...xs: string[]) => xs.map((id) => ({ id }));

describe("Warenkorb-Crossselling (Storefront-Skript)", () => {
  it("wählt reihum aus den Listen der Warenkorb-Artikel", () => {
    expect(ids(pick([list("a1", "a2", "a3"), list("b1", "b2"), list("c1")], [], 5))).toEqual(["a1", "b1", "c1", "a2", "b2"]);
  });

  it("lässt Artikel im Warenkorb und Doppelte weg", () => {
    expect(ids(pick([list("a1", "x", "a2"), list("a1", "b1")], ["x"], 10))).toEqual(["a1", "b1", "a2"]);
  });

  it("hält die Obergrenze ein und verträgt leere Listen", () => {
    expect(ids(pick([list("a1", "a2", "a3")], [], 2))).toEqual(["a1", "a2"]);
    expect(pick([], [], 4)).toEqual([]);
    expect(pick([[], []], ["a"], 4)).toEqual([]);
  });

  it("erkennt den Reiter „Das passt dazu“ trotz Leerraum und Großschreibung", () => {
    expect(config.tabTitles).toContain(normalize("\n   Das  passt DAZU \n"));
  });

  it("läuft nur im Onlineshop META Regalbau DE", () => {
    expect(config.salesChannelIds).toEqual(["018ec134507f703b82a76467791e7e61"]);
  });
});
