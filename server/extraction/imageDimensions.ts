/**
 * Bildmaße aus dem Dateikopf lesen, ohne das Bild zu dekodieren.
 *
 * Hintergrund (Vorfall 20.10.2026, T-1086): Ein 626-KB-PNG mit 9992×9992 Pixeln wird beim
 * Dekodieren zu ~400 MB Rohdaten; die Texterkennung brauchte damit über 1 GB und der Container
 * starb an der Speichergrenze. Die Größe muss deshalb VOR der Texterkennung bekannt sein.
 *
 * Unterstützt die Formate, die Tesseract liest: PNG, JPEG, GIF, BMP, WebP, TIFF (erste Seite).
 */

export type ImageDimensions = { width: number; height: number; format: string };

function pngDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: "png" };
}

function jpegDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1];
    if (marker === 0xff) {
      offset += 1; // Füllbyte
      continue;
    }
    // Marker ohne Längenfeld: RST0–7, SOI, TEM
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    // SOF0–SOF15 außer DHT (C4), JPG (C8), DAC (CC)
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 9 > buf.length) return null;
      return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5), format: "jpeg" };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function gifDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 10 || !/^GIF8[79]a$/.test(buf.toString("latin1", 0, 6))) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), format: "gif" };
}

function bmpDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 26 || buf.toString("latin1", 0, 2) !== "BM") return null;
  // Negative Höhe = von oben nach unten gespeichert
  return { width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)), format: "bmp" };
}

function webpDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 30 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("latin1", 12, 16);
  if (chunk === "VP8X") {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1, format: "webp" };
  }
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: "webp" };
  }
  if (chunk === "VP8 ") {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, format: "webp" };
  }
  return null;
}

function tiffDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 8) return null;
  const order = buf.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > buf.length) return null;
  const entries = u16(ifd);
  let width = 0;
  let height = 0;
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > buf.length) return null;
    const tag = u16(entry);
    if (tag !== 256 && tag !== 257) continue;
    const type = u16(entry + 2);
    const value = type === 3 ? u16(entry + 8) : u32(entry + 8); // SHORT oder LONG
    if (tag === 256) width = value;
    else height = value;
  }
  return width > 0 && height > 0 ? { width, height, format: "tiff" } : null;
}

/** Breite/Höhe des Bildes oder null, wenn das Format unbekannt oder der Kopf beschädigt ist. */
export function readImageDimensions(buf: Buffer): ImageDimensions | null {
  for (const read of [pngDimensions, jpegDimensions, gifDimensions, bmpDimensions, webpDimensions, tiffDimensions]) {
    try {
      const dims = read(buf);
      if (dims) return dims.width > 0 && dims.height > 0 ? dims : null;
    } catch {
      return null; // Kopf kürzer als angegeben
    }
  }
  return null;
}
