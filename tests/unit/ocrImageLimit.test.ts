/**
 * Texterkennung nur für Bilder mit vertretbarer Pixelzahl (Vorfall T-1086, 20.10.2026):
 * Ein 9992×9992-PNG aus einer Kundenmail brachte den 1-GB-Container beim OCR zum Absturz.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const tesseract = vi.hoisted(() => ({
  recognize: vi.fn(async () => ({ data: { text: "Bestellung 4711" } })),
  terminate: vi.fn(async () => undefined),
  createWorker: vi.fn(),
}));
vi.mock("tesseract.js", () => ({ createWorker: tesseract.createWorker }));

import { readImageDimensions } from "../../server/extraction/imageDimensions";
import {
  extractPlainTextForDraft,
  MAX_OCR_IMAGE_PIXELS,
  ocrImageSkipReason,
} from "../../server/extraction/documentTextExtraction";

function png(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "latin1");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8;
  buf[25] = 2;
  return buf;
}

function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0", "latin1"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc2, 0); // progressiv
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, Buffer.from([0xff]), sof]); // mit Füllbyte
}

function tiff(width: number, height: number, littleEndian: boolean): Buffer {
  const buf = Buffer.alloc(8 + 2 + 2 * 12 + 4);
  const u16 = (v: number, o: number) => (littleEndian ? buf.writeUInt16LE(v, o) : buf.writeUInt16BE(v, o));
  const u32 = (v: number, o: number) => (littleEndian ? buf.writeUInt32LE(v, o) : buf.writeUInt32BE(v, o));
  buf.write(littleEndian ? "II" : "MM", 0, "latin1");
  u16(42, 2);
  u32(8, 4);
  u16(2, 8);
  u16(256, 10); u16(3, 12); u32(1, 14); u16(width, 18); // ImageWidth als SHORT
  u16(257, 22); u16(4, 24); u32(1, 26); u32(height, 30); // ImageLength als LONG
  return buf;
}

function webp(kind: "VP8X" | "VP8L" | "VP8 ", width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "latin1");
  buf.write("WEBP", 8, "latin1");
  buf.write(kind, 12, "latin1");
  if (kind === "VP8X") {
    buf.writeUIntLE(width - 1, 24, 3);
    buf.writeUIntLE(height - 1, 27, 3);
  } else if (kind === "VP8L") {
    buf[20] = 0x2f;
    buf.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21);
  } else {
    buf.writeUInt16LE(width, 26);
    buf.writeUInt16LE(height, 28);
  }
  return buf;
}

describe("readImageDimensions", () => {
  it("liest PNG, JPEG, GIF, BMP, WebP und TIFF aus dem Kopf", () => {
    expect(readImageDimensions(png(9992, 9992))).toEqual({ width: 9992, height: 9992, format: "png" });
    expect(readImageDimensions(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024, format: "jpeg" });

    const gif = Buffer.alloc(13);
    gif.write("GIF89a", 0, "latin1");
    gif.writeUInt16LE(640, 6);
    gif.writeUInt16LE(480, 8);
    expect(readImageDimensions(gif)).toEqual({ width: 640, height: 480, format: "gif" });

    const bmp = Buffer.alloc(30);
    bmp.write("BM", 0, "latin1");
    bmp.writeInt32LE(2480, 18);
    bmp.writeInt32LE(-3508, 22); // von oben nach unten gespeichert
    expect(readImageDimensions(bmp)).toEqual({ width: 2480, height: 3508, format: "bmp" });

    expect(readImageDimensions(webp("VP8X", 6000, 4000))).toEqual({ width: 6000, height: 4000, format: "webp" });
    expect(readImageDimensions(webp("VP8L", 1884, 1884))).toEqual({ width: 1884, height: 1884, format: "webp" });
    expect(readImageDimensions(webp("VP8 ", 800, 600))).toEqual({ width: 800, height: 600, format: "webp" });
    expect(readImageDimensions(tiff(1728, 2200, true))).toEqual({ width: 1728, height: 2200, format: "tiff" });
    expect(readImageDimensions(tiff(1728, 2200, false))).toEqual({ width: 1728, height: 2200, format: "tiff" });
  });

  it("gibt null für unbekannte oder abgeschnittene Dateien", () => {
    expect(readImageDimensions(Buffer.from("kein Bild"))).toBeNull();
    expect(readImageDimensions(png(100, 100).subarray(0, 20))).toBeNull();
    expect(readImageDimensions(jpeg(100, 100).subarray(0, 25))).toBeNull();
    expect(readImageDimensions(png(0, 100))).toBeNull();
  });
});

describe("Texterkennung mit Pixelgrenze", () => {
  beforeEach(() => {
    tesseract.recognize.mockClear();
    tesseract.terminate.mockClear();
    tesseract.createWorker.mockReset();
    tesseract.createWorker.mockImplementation(async () => ({
      recognize: tesseract.recognize,
      terminate: tesseract.terminate,
    }));
  });

  it("überspringt das 9992×9992-Bild aus T-1086, ohne Tesseract zu starten", async () => {
    expect(ocrImageSkipReason(png(9992, 9992))).toMatch(/9992×9992 px/);
    const text = await extractPlainTextForDraft({
      fileBuffer: png(9992, 9992),
      mimeType: "image/png",
      fileName: "image003[13].png",
      ocrEnabled: true,
    });
    expect(text).toBe("");
    expect(tesseract.createWorker).not.toHaveBeenCalled();
  });

  it("erkennt Bilder bis zur Grenze, z. B. A4-Scan mit 400 dpi", async () => {
    expect(3307 * 4677).toBeLessThanOrEqual(MAX_OCR_IMAGE_PIXELS);
    const text = await extractPlainTextForDraft({
      fileBuffer: png(3307, 4677),
      mimeType: "image/png",
      fileName: "scan.png",
      ocrEnabled: true,
    });
    expect(text).toBe("Bestellung 4711");
    expect(tesseract.terminate).toHaveBeenCalledTimes(1);
  });

  it("überspringt Bilder mit unlesbarem Kopf", async () => {
    const text = await extractPlainTextForDraft({
      fileBuffer: Buffer.from("kaputt"),
      mimeType: "image/png",
      fileName: "kaputt.png",
      ocrEnabled: true,
    });
    expect(text).toBe("");
    expect(tesseract.createWorker).not.toHaveBeenCalled();
  });

  it("beendet den Worker auch, wenn die Erkennung scheitert", async () => {
    tesseract.recognize.mockRejectedValueOnce(new Error("Speicher"));
    await expect(
      extractPlainTextForDraft({ fileBuffer: jpeg(800, 600), mimeType: "image/jpeg", fileName: "a.jpg", ocrEnabled: true }),
    ).rejects.toThrow("Speicher");
    expect(tesseract.terminate).toHaveBeenCalledTimes(1);
  });

  it("lässt nur eine Texterkennung zur Zeit laufen", async () => {
    let running = 0;
    let maxRunning = 0;
    tesseract.recognize.mockImplementation(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
      return { data: { text: "x" } };
    });
    const ocr = (name: string) =>
      extractPlainTextForDraft({ fileBuffer: png(1000, 1000), mimeType: "image/png", fileName: name, ocrEnabled: true });
    await Promise.all([ocr("a.png"), ocr("b.png"), ocr("c.png")]);
    expect(maxRunning).toBe(1);
    expect(tesseract.terminate).toHaveBeenCalledTimes(3);
  });
});
