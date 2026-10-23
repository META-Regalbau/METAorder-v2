/**
 * Sicherheits-Härtung (Prüfung 23.10.2026):
 * - Anhänge: Absender-MIME-Typ wird nur für harmlose Typen inline ausgeliefert (kein Stored XSS über SVG/HTML)
 * - gespeicherte Zugangsdaten nur an die gespeicherte Adresse (URL bzw. Host/Port)
 * - Client-IP für Rate-Limits aus req.ip, nicht aus dem selbst gesetzten X-Forwarded-For
 * - /ingest-Debug-Senke nur außerhalb von Produktion
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { safeFileHeaders, isInlineSafeMimeType } from "../../server/lib/safeFileResponse";
import { mayReuseStoredSecretForHost, mayReuseStoredSecretForUrl } from "../../server/lib/storedSecretTarget";
import { clientIp } from "../../server/lib/clientIp";

const root = path.resolve(__dirname, "../..");

describe("Datei-Antworten für Anhänge", () => {
  it("PDF und Rasterbilder inline, PDF ohne Sandbox (Chrome-Viewer)", () => {
    expect(safeFileHeaders({ mimeType: "application/pdf", fileName: "AB 1.pdf", wanted: "inline" })).toEqual({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="AB%201.pdf"',
      "X-Content-Type-Options": "nosniff",
    });
    const png = safeFileHeaders({ mimeType: "IMAGE/PNG; name=x.png", fileName: "x.png", wanted: "inline" });
    expect(png["Content-Type"]).toBe("image/png");
    expect(png["Content-Disposition"]).toMatch(/^inline;/);
    expect(png["Content-Security-Policy"]).toMatch(/^sandbox;/);
    expect(safeFileHeaders({ mimeType: "text/plain", fileName: "a.txt", wanted: "inline" })["Content-Type"]).toBe("text/plain; charset=utf-8");
  });

  it("SVG, HTML, XML und unbekannte Typen nur als neutraler Download mit Sandbox", () => {
    for (const mime of ["image/svg+xml", "text/html", "application/xhtml+xml", "text/xml", "application/xml", "application/javascript", "", null]) {
      const h = safeFileHeaders({ mimeType: mime, fileName: "x", wanted: "inline" });
      expect(h["Content-Type"]).toBe("application/octet-stream");
      expect(h["Content-Disposition"]).toMatch(/^attachment;/);
      expect(h["Content-Security-Policy"]).toMatch(/^sandbox;/);
      expect(isInlineSafeMimeType(mime)).toBe(false);
    }
  });

  it("Download bleibt Download, auch für harmlose Typen", () => {
    expect(safeFileHeaders({ mimeType: "application/pdf", fileName: "a.pdf", wanted: "attachment" })["Content-Disposition"]).toMatch(/^attachment;/);
  });

  it("Dateiname kann den Header nicht aufbrechen", () => {
    const h = safeFileHeaders({ mimeType: "application/pdf", fileName: 'a";\r\nSet-Cookie: x=1.pdf', wanted: "inline" });
    expect(h["Content-Disposition"]).toBe('inline; filename="a%22%3B%0D%0ASet-Cookie%3A%20x%3D1.pdf"');
  });

  it("alle Anhangs-Routen nutzen die sichere Auslieferung", () => {
    for (const file of ["server/commercial/draftAttachmentRoutes.ts", "server/routes/ticketRoutes.ts"]) {
      const src = readFileSync(path.join(root, file), "utf8");
      expect(src).toContain("setSafeFileHeaders(");
      expect(src).not.toMatch(/setHeader\(\s*["']Content-Type["'],\s*attachment\.mimeType/);
    }
  });
});

describe("gespeicherte Zugangsdaten nur an die gespeicherte Adresse", () => {
  it("URL: gleicher Ursprung ja (Pfad egal), andere Adresse nein", () => {
    expect(mayReuseStoredSecretForUrl("https://shop.meta-online.com/", "https://shop.meta-online.com")).toBe(true);
    expect(mayReuseStoredSecretForUrl("https://SHOP.meta-online.com/api", "https://shop.meta-online.com")).toBe(true);
    expect(mayReuseStoredSecretForUrl("https://shop.meta-online.com.evil.example", "https://shop.meta-online.com")).toBe(false);
    expect(mayReuseStoredSecretForUrl("http://shop.meta-online.com", "https://shop.meta-online.com")).toBe(false);
    expect(mayReuseStoredSecretForUrl("https://shop.meta-online.com:8443", "https://shop.meta-online.com")).toBe(false);
    expect(mayReuseStoredSecretForUrl("", "https://shop.meta-online.com")).toBe(false);
    expect(mayReuseStoredSecretForUrl("https://a.example", null)).toBe(false);
  });

  it("SFTP: Host und Port müssen gleich bleiben", () => {
    expect(mayReuseStoredSecretForHost({ host: "SFTP.Firma.de", port: 22 }, { host: "sftp.firma.de", port: 22 })).toBe(true);
    expect(mayReuseStoredSecretForHost({ host: "sftp.firma.de" }, { host: "sftp.firma.de", port: 22 })).toBe(true);
    expect(mayReuseStoredSecretForHost({ host: "sftp.firma.de", port: 2222 }, { host: "sftp.firma.de", port: 22 })).toBe(false);
    expect(mayReuseStoredSecretForHost({ host: "evil.example", port: 22 }, { host: "sftp.firma.de", port: 22 })).toBe(false);
  });

  it("Shopware-, Pimcore-, n8n- und SFTP-Routen prüfen die Adresse vor dem gespeicherten Secret", () => {
    const settingsSrc = readFileSync(path.join(root, "server/routes/settingsRoutes.ts"), "utf8");
    expect(settingsSrc.match(/mayReuseStoredSecretForUrl\(/g)?.length).toBe(6);
    const sftpSrc = readFileSync(path.join(root, "server/sftp/sftpRoutes.ts"), "utf8");
    expect(sftpSrc.match(/guardStoredSftpSecrets\(/g)?.length).toBe(3);
  });
});

describe("Client-IP für Rate-Limits", () => {
  const ipOf = async (trustProxy: number, headers: Record<string, string>) => {
    const app = express();
    app.set("trust proxy", trustProxy);
    app.get("/ip", (req, res) => res.json({ ip: clientIp(req) }));
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ip`, { headers });
      return ((await res.json()) as { ip: string }).ip;
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  };

  it("vom Aufrufer vorangestellte Einträge zählen nicht; nur der vom Proxy angehängte", async () => {
    // Proxy hängt die echte IP an: "<gefälscht>, <echt>"
    expect(await ipOf(1, { "X-Forwarded-For": "1.2.3.4, 203.0.113.9" })).toBe("203.0.113.9");
    expect(await ipOf(1, { "X-Forwarded-For": "203.0.113.9" })).toBe("203.0.113.9");
  });

  it("öffentliche Routen nutzen keinen eigenen X-Forwarded-For-Parser mehr", () => {
    for (const file of ["server/offers/publicOfferRoutes.ts", "server/b2b/portalPasswordRequestRoutes.ts", "server/commercial/commercialAcknowledgementRoutes.ts"]) {
      const src = readFileSync(path.join(root, file), "utf8");
      expect(src).not.toMatch(/x-forwarded-for/i);
      expect(src).toContain('from "../lib/clientIp"');
    }
  });
});

describe("Debug-Senke /ingest", () => {
  it("wird nur außerhalb von Produktion registriert", () => {
    const src = readFileSync(path.join(root, "server/index.ts"), "utf8");
    expect(src).toMatch(/if \(process\.env\.NODE_ENV !== "production"\) \{\s*app\.post\("\/ingest\/:id"/);
    expect(src).toContain('process.env.NODE_ENV !== "production" && req.path.startsWith("/ingest/")');
  });
});
