/**
 * Lokales Embedding v2 (ohne KI-Anbieter): v1 zaehlte jedes Vorkommen, die EAN stand in Produkttexten
 * doppelt, ~5.700 EANs belegten die 1.536 Faecher - "Kragarmregal" fiel ins Fach der EAN eines
 * "KR H Profil" (Aehnlichkeit 0,53, Platz 1 der Suche). v2: jedes Wort einmal, lange Ziffernfolgen
 * nicht im Vektor (die findet die Wortsuche), Vorzeichen je Wort. Nullvektor -> nur Wortsuche.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({ executes: [] as any[] }));
vi.mock("../../server/db", () => ({
  db: { execute: async (q: any) => { dbMock.executes.push(q); return { rows: [] }; } },
  pool: {},
}));

import { PgDialect } from "drizzle-orm/pg-core";
import { createLocalEmbedding, isZeroEmbedding, LOCAL_EMBEDDING_MODEL } from "../../server/semantic/semanticEmbeddings";
import { rankSemanticCandidates } from "../../server/semantic/semanticRanking";
import { DbStorage } from "../../server/dbStorage";

const cos = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
// Inhalte wie im Suchindex (Testing)
const profil = "KR H Profil 220 ER 4800 R5010\n4026212369212\nMETA Regalbau\n303573\n4026212369212\nKragarmregale";
const regal = "META MULTISTRONG M | Kragarmregal | Grundregal | 3000 x 1000 x 500 mm\nKragarmregal einseitig\nKragarmregale";

describe("lokales Embedding v2", () => {
  it("Modellkennung neu (der Index rechnet v1-Dokumente neu)", () => {
    expect(LOCAL_EMBEDDING_MODEL).toBe("local-hash-v2");
  });

  it("Kragarmregal: keine Kollision mehr mit der EAN des KR-H-Profils, das echte Regal ist aehnlich", () => {
    const q = createLocalEmbedding("Kragarmregal");
    expect(cos(q, createLocalEmbedding(profil))).toBeCloseTo(0, 6);
    expect(cos(q, createLocalEmbedding(regal))).toBeGreaterThan(0.2);
  });

  it("jedes Wort einmal, lange Nummern nicht im Vektor, normiert", () => {
    // v1: "Regal" doppelt gewichtet -> andere Richtung als "Regal Boden"
    expect(createLocalEmbedding("Regal Regal Boden")).toEqual(createLocalEmbedding("Regal Boden"));
    expect(createLocalEmbedding("Regal 4026212289640 4026212289640")).toEqual(createLocalEmbedding("Regal"));
    expect(createLocalEmbedding("Regal 1000")).not.toEqual(createLocalEmbedding("Regal"));
    const v = createLocalEmbedding("Fachboden verzinkt 1000 x 400");
    expect(cos(v, v)).toBeCloseTo(1, 6);
  });

  it("Vorzeichen je Wort: Kollisionen heben sich im Mittel auf (Eintraege +/-)", () => {
    const v = createLocalEmbedding("META CLIP Fachbodenregal Grundregal verzinkt Fachlast Ebenen Kragarmregal einseitig Rohrkragarm");
    expect(v.some((x) => x > 0)).toBe(true);
    expect(v.some((x) => x < 0)).toBe(true);
  });

  it("nur eine EAN: Nullvektor", () => {
    expect(isZeroEmbedding(createLocalEmbedding("4026212289640"))).toBe(true);
    expect(isZeroEmbedding(createLocalEmbedding("Regal"))).toBe(false);
  });
});

describe("Suche mit Nullvektor", () => {
  const render = (q: any) => new PgDialect().sqlToQuery(q).sql;
  const storage = () => Object.assign(new DbStorage(), { getSetting: async () => undefined });

  it("Anfrage nur aus einer EAN: nur die Wortliste (keine zufaellige Vektorliste)", async () => {
    dbMock.executes.length = 0;
    await storage().searchSemanticDocuments(createLocalEmbedding("4026212289640"), { limit: 5, query: "4026212289640", localQueryEmbedding: true }, "t1");
    const sql = render(dbMock.executes[0]);
    expect(sql).toMatch(/WHERE lexical > 0/);
    expect(sql).not.toMatch(/ORDER BY distance ASC, text_rank DESC/);
    expect(sql).not.toMatch(/UNION ALL/);
  });

  it("Nullvektor ohne Anfrage: keine Abfrage", async () => {
    dbMock.executes.length = 0;
    expect(await storage().searchSemanticDocuments(new Array(1536).fill(0), { limit: 5 }, "t1")).toEqual([]);
    expect(dbMock.executes).toHaveLength(0);
  });

  it("Abstand NaN (Nullvektor im Index) zaehlt als 'nicht aehnlich' statt die Sortierung zu brechen", () => {
    const base = { sourceType: "product", content: "", metadata: {}, textRank: 0 };
    const ranked = rankSemanticCandidates(
      [
        { ...base, sourceId: "nan", title: "Regal", distance: Number.NaN },
        { ...base, sourceId: "nah", title: "Regal", distance: 0.2 },
      ],
      { query: "Regal", localQueryEmbedding: true },
    );
    expect(ranked.map((r) => r.sourceId)).toEqual(["nah", "nan"]);
    expect(ranked.every((r) => Number.isFinite(r.hybridScore))).toBe(true);
  });
});
