/**
 * Produktsuche "Fachboden": Produktseite (Spiegel-SQL), semantische Suche und KI-Produktsuche.
 * Vorher: ganze Eingabe als ein Teilstring ("Fachboden 1000 x 400" -> 0 Treffer), Reihenfolge nach
 * Artikelnummer (bei "Fachboden" zuerst Fachbodentraeger); semantische Suche nur mit Kandidaten aus
 * der Vektorsuche - lokale Hash-Embeddings kollidieren, "Kragarmregal" lieferte "KR H Profil ...".
 * Datenbank gemockt, SQL wird mit dem Postgres-Dialekt von drizzle gerendert.
 * Ausführung: npm test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const dbMock = vi.hoisted(() => ({
  wheres: [] as any[],
  orders: [] as any[][],
  executes: [] as any[],
  selectResults: [] as any[][],
  executeRows: [] as any[],
}));
vi.mock("../../server/db", () => {
  const chain: any = {};
  chain.from = () => chain;
  chain.where = (w: any) => { dbMock.wheres.push(w); return chain; };
  chain.orderBy = (...o: any[]) => { dbMock.orders.push(o); return chain; };
  chain.limit = () => chain;
  chain.offset = () => chain;
  chain.then = (res: (v: any[]) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(dbMock.selectResults.shift() ?? []).then(res, rej);
  return {
    db: {
      select: () => chain,
      execute: async (query: any) => { dbMock.executes.push(query); return { rows: dbMock.executeRows }; },
    },
    pool: {},
  };
});
const llm = vi.hoisted(() => ({ reply: "{}" }));
vi.mock("../../server/ai/llmChat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/ai/llmChat")>()),
  chatCompletion: async () => llm.reply,
}));

import { DbStorage } from "../../server/dbStorage";
import { productRelevance, searchTokens, sortByRelevance } from "../../server/products/productSearchRanking";
import { lexicalScore, rankSemanticCandidates, type SemanticCandidate } from "../../server/semantic/semanticRanking";
import { executeSemanticProductSearch } from "../../server/semantic/semanticProductSearch";

const dialect = new PgDialect();
const render = (query: any) => dialect.sqlToQuery(query);

beforeEach(() => {
  dbMock.wheres.length = 0;
  dbMock.orders.length = 0;
  dbMock.executes.length = 0;
  dbMock.selectResults.length = 0;
  dbMock.executeRows = [];
});

describe("Suchwoerter und Relevanz", () => {
  it("Woerter statt Teilstring: Einzelzeichen wie 'x' fallen weg, Ziffern bleiben, doppelte einmal", () => {
    expect(searchTokens("Fachboden 1000 x 400")).toEqual(["fachboden", "1000", "400"]);
    expect(searchTokens("  Zusatz-Fachboden, 2 Stück / fachboden ")).toEqual(["zusatz-fachboden", "2", "stück", "fachboden"]);
    expect(searchTokens("")).toEqual([]);
  });

  it("ganzes Wort (auch nach Bindestrich) > Teil eines Worts > nur im Zusatztext; exakte Nummer vorn", () => {
    const t = searchTokens("Fachboden");
    const zusatz = productRelevance("META CLIP | Zusatz-Fachboden | 1000 x 400 mm", t);
    const traeger = productRelevance("CL Fachbodenträger 40 vzk", t);
    const beschreibung = productRelevance("Steckregal", t, { extraText: "mit 5 Fachboden" });
    expect([zusatz, traeger, beschreibung]).toEqual([10, 2, 1]);
    expect(productRelevance("Regal", t)).toBe(0);
    expect(productRelevance("Fachboden MS230", ["4026212289640"], { query: "4026212289640", exactNumbers: [null, "4026212289640"] })).toBe(1000);
  });

  it("Sortierung nach Relevanz, gleiche Relevanz in bisheriger Reihenfolge", () => {
    const names = ["CL Fachbodenträger 40", "Fachbodenregal SET", "Zusatz-Fachboden 1000", "Fachboden MS230"];
    const tokens = searchTokens("Fachboden");
    expect(sortByRelevance(names, (n) => productRelevance(n, tokens))).toEqual([
      "Zusatz-Fachboden 1000",
      "Fachboden MS230",
      "CL Fachbodenträger 40",
      "Fachbodenregal SET",
    ]);
  });

  it("Wortanteil 0..1 fuer die semantische Suche", () => {
    const tokens = searchTokens("Rohrkragarm RAL 5010");
    expect(lexicalScore("META MULTISTRONG L+M | Rohrkragarm | 400 mm | RAL 5010", "", tokens)).toBe(1);
    expect(lexicalScore("META MULTIPAL | Kabeltrommelregal | RAL 5010", "", tokens)).toBeCloseTo(2 / 3);
    expect(lexicalScore("KR H Profil", "Kragarmregale", searchTokens("Kragarmregal"))).toBeCloseTo(0.1);
    expect(lexicalScore("egal", "egal", [])).toBe(0);
  });
});

describe("Semantische Suche: Reihenfolge", () => {
  // Werte aus der Messung (Mandant Testing): die EAN des KR-H-Profils landet im selben Hash-Fach wie "kragarmregal"
  const profil: SemanticCandidate = {
    sourceType: "product", sourceId: "kr-h", title: "KR H Profil 220 ER 4800 R5010 (4026212369212)",
    content: "KR H Profil 220 ER 4800 R5010 | 4026212369212 | Kragarmregale",
    metadata: { productNumber: "4026212369212", categories: ["Kragarmregale"] }, distance: 0.47, textRank: 0,
  };
  const regal: SemanticCandidate = {
    sourceType: "product", sourceId: "kragarm", title: "META MULTISTRONG M | Kragarmregal | Grundregal (4026212119831)",
    content: "META MULTISTRONG M | Kragarmregal | Grundregal | Kragarmregale",
    metadata: { productNumber: "4026212119831", categories: ["Kragarmregale"] }, distance: 0.82, textRank: 0.1,
  };
  const ids = (list: SemanticCandidate[]) => list.map((c) => c.sourceId);

  it("lokales Anfrage-Embedding: Wortanteil schlaegt Hash-Kollision", () => {
    expect(ids(rankSemanticCandidates([profil, regal], { query: "Kragarmregal", localQueryEmbedding: true }))).toEqual(["kragarm", "kr-h"]);
  });

  it("echtes Embedding (OpenAI): der Vektor zaehlt voll", () => {
    const naeher = { ...profil, distance: 0.1 };
    expect(ids(rankSemanticCandidates([regal, naeher], { query: "Kragarmregal", localQueryEmbedding: false }))).toEqual(["kr-h", "kragarm"]);
    expect(ids(rankSemanticCandidates([regal, naeher], { query: "Kragarmregal", localQueryEmbedding: true }))).toEqual(["kragarm", "kr-h"]);
  });

  it("Gewichte aus den Einstellungen gelten weiter (nur Vektor -> Abstand entscheidet)", () => {
    const settings = { vectorWeight: 1, textWeight: 0, metadataWeight: 0, feedbackWeight: 0 };
    expect(ids(rankSemanticCandidates([regal, profil], { query: "Kragarmregal", localQueryEmbedding: true, rankingSettings: settings }))).toEqual(["kr-h", "kragarm"]);
  });

  it("exakte Nummer steht vorn, auch wenn sie weder im Titel steht noch der Abstand passt", () => {
    const nummer = { ...profil, title: "KR H Profil", content: "KR H Profil", metadata: { manufacturerNumber: "303573" }, distance: 0.99 };
    const aehnlich = { ...regal, title: "Kragarmregal 3035734", distance: 0.1 };
    expect(ids(rankSemanticCandidates([aehnlich, nummer], { query: "303573", localQueryEmbedding: true }))).toEqual(["kr-h", "kragarm"]);
  });

  it("Rueckmeldungen zur selben Anfrage heben einen Treffer", () => {
    const zweites = { ...regal, sourceId: "kragarm-2", title: "META MULTISTRONG L | Kragarmregal | Anbauregal", distance: 0.82 };
    const feedbackEntries = [{ query: " kragarmregal ", sourceType: "product", sourceId: "kragarm-2" }];
    expect(ids(rankSemanticCandidates([regal, zweites], { query: "Kragarmregal", localQueryEmbedding: true }))).toEqual(["kragarm", "kragarm-2"]);
    expect(ids(rankSemanticCandidates([regal, zweites], { query: "Kragarmregal", localQueryEmbedding: true, feedbackEntries }))).toEqual(["kragarm-2", "kragarm"]);
  });

  it("ohne Anfragetext (aehnliche Dokumente): nur der Abstand", () => {
    expect(ids(rankSemanticCandidates([regal, profil], {}))).toEqual(["kr-h", "kragarm"]);
  });
});

describe("Produktseite: Spiegel-Suche (SQL)", () => {
  it("jedes Wort einzeln (UND), Relevanz vor Artikelnummer, exakte Nummer zuerst", async () => {
    dbMock.selectResults.push([{ value: 2 }], [{ id: "a" }, { id: "b" }]);
    const result = await new DbStorage().getShopwareProductMirrors({ search: " Fachboden 1000 x 400 ", activeOnly: true, page: 1, limit: 5 }, "t1");
    expect(result).toEqual({ rows: [{ id: "a" }, { id: "b" }], total: 2 });

    const where = render(dbMock.wheres[0]);
    expect(where.params).toEqual(expect.arrayContaining(["%fachboden%", "%1000%", "%400%"]));
    expect(where.params).not.toContain("%Fachboden 1000 x 400%");
    expect(where.params).not.toContain("%x%");
    expect(where.sql.match(/ ilike /gi)).toHaveLength(12); // 3 Woerter x (Nummer, Name, Herstellernummer, EAN)
    expect(where.sql).toMatch(/\) and \(/); // Woerter mit UND verknuepft

    const [relevance, byNumber] = dbMock.orders[0].map(render);
    expect(relevance.sql).toMatch(/~\*/);
    expect(relevance.params).toEqual(expect.arrayContaining(["\\mfachboden\\M", "\\m1000\\M", "\\m400\\M", "fachboden 1000 x 400", 10, 2, 1000]));
    expect(relevance.sql.trim()).toMatch(/DESC$/);
    expect(byNumber.sql).toMatch(/"product_number" asc/);
  });

  it("Sonderzeichen werden im Wortgrenzen-Ausdruck maskiert", async () => {
    dbMock.selectResults.push([{ value: 0 }], []);
    await new DbStorage().getShopwareProductMirrors({ search: "L+M (40)", page: 1, limit: 5 }, "t1");
    expect(render(dbMock.orders[0][0]).params).toEqual(expect.arrayContaining(["\\ml\\+m\\M", "\\m\\(40\\)\\M"]));
  });

  it("ohne Suche: nur nach Artikelnummer", async () => {
    dbMock.selectResults.push([{ value: 0 }], []);
    await new DbStorage().getShopwareProductMirrors({ page: 1, limit: 5 }, "t1");
    expect(dbMock.orders[0]).toHaveLength(1);
  });
});

describe("Semantische Suche: Kandidaten aus Vektor- und Wortsuche (SQL)", () => {
  const storage = () => {
    const s = new DbStorage();
    s.getSetting = async () => undefined;
    return s;
  };
  const row = (id: string, title: string, distance: number) => ({
    id, source_type: "product", source_id: id, title, content: title, metadata: {}, distance, text_rank: 0,
  });

  it("mit Anfrage: UNION aus Vektor- und Wortliste, doppelte Kandidaten einmal, Ergebnis gekuerzt", async () => {
    dbMock.executeRows = [
      row("profil", "KR H Profil 220", 0.47),
      row("regal-1", "META MULTISTRONG | Kragarmregal | Grundregal", 0.82),
      row("regal-1", "META MULTISTRONG | Kragarmregal | Grundregal", 0.82),
      row("regal-2", "META MULTISTRONG | Kragarmregal | Anbauregal", 0.83),
    ];
    const results = await storage().searchSemanticDocuments([1, 0], { limit: 2, query: "Kragarmregal", localQueryEmbedding: true }, "t1");
    expect(results.map((r) => r.sourceId)).toEqual(["regal-1", "regal-2"]);

    const query = render(dbMock.executes[0]);
    expect(query.sql).toMatch(/UNION ALL/);
    expect(query.sql).toMatch(/WHERE lexical > 0 ORDER BY lexical DESC/);
    expect(query.params).toEqual(expect.arrayContaining(["\\mkragarmregal\\M", "%kragarmregal%"]));
  });

  it("ohne Anfrage (aehnliche Dokumente): nur die Vektorliste", async () => {
    dbMock.executeRows = [row("b", "B", 0.4), row("a", "A", 0.2)];
    const results = await storage().searchSemanticDocuments([1, 0], { limit: 5 }, "t1");
    expect(results.map((r) => r.sourceId)).toEqual(["a", "b"]);
    expect(render(dbMock.executes[0]).sql).not.toMatch(/UNION/);
  });
});

describe("KI-Produktsuche: beste Treffer zuerst", () => {
  const product = (name: string, productNumber: string) => ({ id: productNumber, name, productNumber, description: "" }) as any;

  it("Fachboden: Faecher vor Fachbodentraegern und Fachbodenregalen, exakte Nummer ganz vorn", async () => {
    llm.reply = JSON.stringify({ productType: "Fachboden", keywords: ["Fachboden"] });
    const catalog = [
      product("CL Fachbodenträger 40 vzk", "1"),
      product("META CLIP SET | Fachbodenregal | Grundregal", "2"),
      product("META CLIP | Zusatz-Fachboden | 1000 x 400 mm", "3"),
      product("Kragarmregal", "4"),
    ];
    const result = await executeSemanticProductSearch({ query: "Fachboden" }, catalog);
    expect(result.products.map((p) => p.productNumber)).toEqual(["3", "1", "2"]);

    llm.reply = JSON.stringify({ keywords: ["fachbodenträger", "1"] });
    const exact = await executeSemanticProductSearch({ query: "1" }, catalog);
    expect(exact.products[0].productNumber).toBe("1");
  });
});
