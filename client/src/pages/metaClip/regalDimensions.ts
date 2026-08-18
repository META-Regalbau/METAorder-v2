/**
 * Bemaßung für die 3D-Regalansicht — als echte THREE-Objekte, nicht als DOM-Overlay.
 *
 * Grund: dieselbe Bemaßung soll im Live-Viewport (MetaClipRegalAssembly) UND im
 * Offscreen-Rendering für das Angebots-PDF (captureRegalImage.ts) erscheinen. Ein
 * HTML-Overlay (drei `<Html>`) würde im `renderer.toDataURL()` fehlen — Linien aus
 * LineSegments und Maßzahlen als Canvas-Sprites landen in beiden.
 *
 * Bemaßt wird pro Ansicht nur, was dort nicht auf einen Punkt zusammenfällt:
 *   Perspektive  → Länge, Feldbreite, Höhe, Tiefe
 *   Vorderansicht→ Länge, Feldbreite, Höhe   (Tiefe zeigt zur Kamera)
 *   Draufsicht   → Länge, Feldbreite, Tiefe  (Höhe zeigt zur Kamera)
 *
 * Der Fachabstand bleibt — wie in der 2D-Schemazeichnung — unbemaßt: die Böden sind
 * im Lochraster frei einhängbar, die Konfiguration legt nur ihre Anzahl fest.
 *
 * Maßzahlen: Höhe und Tiefe werden als Nennmaß beschriftet (die Geometrie weicht nur
 * um den 2-mm-Kappenplatzhalter bzw. den Rahmenüberstand ab), die Gesamtlänge dagegen
 * aus der echten Bounding-Box des Aufbaus — siehe LENGTH_FROM_GEOMETRY.
 */
import * as THREE from "three";
import type { BuildRegalResult } from "./regalAssembly";

/**
 * Gesamtlänge aus der gebauten Geometrie messen (true) statt aus `overallLength()`
 * der UI (false).
 *
 * Beide Werte widersprechen sich: die 3D-Assembly setzt N+1 Rahmen im Raster der
 * Feldbreite (Rahmenaußenkante ±38 mm), ergibt also N × FL + 76 mm; `overallLength()`
 * rechnet N × FL + (N+1) × 40 mm, als wäre die Feldbreite das lichte Maß zwischen den
 * Ständern. Bei 3 × 1000 mm sind das 3.076 gegen 3.160 mm. Solange nicht geklärt ist,
 * welches Modell dem Katalog entspricht, beschriftet die Zeichnung das, was sie
 * tatsächlich zeichnet — eine Maßzahl, die nicht zu ihrer eigenen Maßlinie passt,
 * wäre der schlimmere Fehler, gerade im Angebots-PDF.
 */
const LENGTH_FROM_GEOMETRY = true;

const DIM_COLOR = 0x8b969e; // --meta-steel, wie die Maßlinien der 2D-Zeichnung
const DIM_LABEL_COLOR = "#ff0002"; // --meta-red; nur die Maßzahlen, die Linien bleiben ruhig

export type RegalDimensionOptions = {
  widthMM: number;
  heightMM: number;
  depthMM: number;
  fieldCount: number;
  /** 0 Perspektive, 1 Vorderansicht, 2 Draufsicht */
  view: number;
  lang?: "de" | "en";
  /** Gesamtlänge laut UI (overallLength) — nur genutzt, wenn LENGTH_FROM_GEOMETRY false ist. */
  overallLengthMM?: number;
};

function formatMM(mm: number, lang: "de" | "en"): string {
  return `${new Intl.NumberFormat(lang === "en" ? "en-US" : "de-DE").format(Math.round(mm))} mm`;
}

/**
 * Maßzahl als Canvas-Sprite. Sprites drehen sich immer zur Kamera, damit die Zahl in
 * jeder Ansicht und in jeder Orbit-Position lesbar bleibt; der weiße Halo hält sie
 * auch vor dem verzinkten Stahl lesbar.
 */
function makeLabel(text: string, heightM: number): THREE.Sprite {
  const fontPx = 64;
  const padX = 14;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `600 ${fontPx}px Inter, system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(text).width) + padX * 2;
  canvas.height = Math.round(fontPx * 1.5);
  // Größenänderung setzt den 2D-Kontext zurück — Font/Style danach erneut setzen.
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 10;
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = DIM_LABEL_COLOR;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true }),
  );
  sprite.scale.set((heightM * canvas.width) / canvas.height, heightM, 1);
  sprite.renderOrder = 11;
  return sprite;
}

type Vec3 = [number, number, number];

/** Sammelt Maßlinien-Segmente; alle Maße landen in einem einzigen LineSegments-Objekt. */
class SegmentBuffer {
  readonly points: number[] = [];
  add(a: Vec3, b: Vec3) {
    this.points.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
}

export function buildRegalDimensions(built: BuildRegalResult, opts: RegalDimensionOptions): THREE.Group {
  const group = new THREE.Group();
  const lang = opts.lang ?? "de";
  const view = opts.view;

  built.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(built.group);

  const flM = opts.widthMM / 1000;
  const heightM = opts.heightMM / 1000;
  const depthM = opts.depthMM / 1000;
  const xMin = box.min.x;
  const xMax = box.max.x;
  const zFront = box.max.z;
  const measuredLengthMM = (xMax - xMin) * 1000;
  const lengthMM = LENGTH_FROM_GEOMETRY ? measuredLengthMM : (opts.overallLengthMM ?? measuredLengthMM);

  // Abstand der Maßketten vom Bauteil, proportional zur Regalgröße: bei kleinen Regalen
  // sonst zu weit weg, bei einer 15-Feld-Zeile sonst zu dicht am Rahmen.
  const gap = Math.min(0.32, Math.max(0.09, 0.045 * Math.max(xMax - xMin, heightM, depthM)));
  const tick = gap * 0.28;
  // Maßzahl-Höhe in Weltmaß: groß genug, damit sie auch in den kleinen PDF-Kacheln
  // (Vorderansicht/Draufsicht, je ~600 px breit) noch lesbar ist.
  const labelH = gap * 0.95;

  const seg = new SegmentBuffer();
  /** Setzt die Maßzahl und liefert ihre Breite in Weltmaß zurück (für die Kettenabstände). */
  const addLabel = (text: string, at: Vec3): number => {
    const sprite = makeLabel(text, labelH);
    sprite.position.set(at[0], at[1], at[2]);
    group.add(sprite);
    return sprite.scale.x;
  };

  /** Endstriche als Kreuz aus zwei kurzen Segmenten — je nach Ansicht ist eines davon sichtbar. */
  const crossTick = (at: Vec3, axes: ["x" | "y" | "z", "x" | "y" | "z"]) => {
    for (const axis of axes) {
      const d: Vec3 = [axis === "x" ? tick : 0, axis === "y" ? tick : 0, axis === "z" ? tick : 0];
      seg.add([at[0] - d[0], at[1] - d[1], at[2] - d[2]], [at[0] + d[0], at[1] + d[1], at[2] + d[2]]);
    }
  };

  // Lage der Maßketten je Ansicht — beides gegen Perspektivfehler.
  //
  // `baseY`: In der Draufsicht blickt eine perspektivische Kamera von oben auf die
  // oberste Regalebene; eine Maßkette auf Bodenhöhe ist gut zwei Meter weiter weg und
  // wird dadurch spürbar kleiner abgebildet — sie sähe kürzer aus als das Regal, das sie
  // bemaßt. Deshalb liegen die Ketten dort auf Höhe der sichtbaren Oberseite.
  //
  // `offsetBelow`/`offsetFront`: In Vorder- und Draufsicht bleibt der Versatz in der
  // Bildebene, aus demselben Grund. Nur die Perspektive versetzt in beide Richtungen.
  const baseY = view === 2 ? box.max.y : 0;
  const offsetBelow = view === 2 ? 0 : 1; // −Y
  const offsetFront = view === 1 ? 0 : 1; // +Z

  // ---- Längenmaße (Feldbreite innen, Gesamtlänge außen) ----
  const lengthChain = (x1: number, x2: number, level: number, label: string) => {
    const y = baseY - gap * level * offsetBelow;
    const z = zFront + gap * level * offsetFront;
    const a: Vec3 = [x1, y, z];
    const b: Vec3 = [x2, y, z];
    seg.add(a, b);
    crossTick(a, ["y", "z"]);
    crossTick(b, ["y", "z"]);
    // Maßhilfslinien von der Bauteilkante zur Maßlinie
    seg.add([x1, baseY, zFront], a);
    seg.add([x2, baseY, zFront], b);
    addLabel(label, [(x1 + x2) / 2, y + labelH * 0.85, z]);
  };

  // Bei einem einzelnen Feld deckt die Gesamtlänge die Feldbreite schon ab; zwei fast
  // gleich lange Ketten übereinander wären nur Rauschen.
  let chainLevel = 0;
  if (opts.fieldCount > 1) lengthChain(0, flM, ++chainLevel, formatMM(opts.widthMM, lang));
  lengthChain(xMin, xMax, ++chainLevel, formatMM(lengthMM, lang));

  // ---- Höhe (links, in der Frontebene) ----
  if (view !== 2) {
    const x = xMin - gap;
    const z = zFront + gap * offsetFront;
    const a: Vec3 = [x, 0, z];
    const b: Vec3 = [x, heightM, z];
    seg.add(a, b);
    crossTick(a, ["x", "z"]);
    crossTick(b, ["x", "z"]);
    seg.add([xMin, 0, zFront], a);
    seg.add([xMin, heightM, zFront], b);
    addLabel(formatMM(opts.heightMM, lang), [x - labelH * 0.9, heightM / 2, z]);
  }

  // ---- Tiefe: Nennmaß innen, echtes Außenmaß außen ----
  // Die Feldtiefe (500) ist die Bodentiefe; der Ständerrahmen steht vorne und hinten über
  // und braucht real 545 mm Stellfläche. Für die Aufstellplanung zählt das zweite Maß.
  const depthChain = (z1: number, z2: number, offset: number, level: number, label: string): number => {
    const x = xMax + offset;
    const y = baseY - gap * level * offsetBelow;
    const a: Vec3 = [x, y, z1];
    const b: Vec3 = [x, y, z2];
    seg.add(a, b);
    crossTick(a, ["x", "y"]);
    crossTick(b, ["x", "y"]);
    seg.add([xMax, baseY, z1], a);
    seg.add([xMax, baseY, z2], b);
    return addLabel(label, [x + labelH * 0.9, y, (z1 + z2) / 2]);
  };

  if (view !== 1) {
    const nominalWidth = depthChain(
      built.frameZCenterM - depthM / 2,
      built.frameZCenterM + depthM / 2,
      gap,
      1,
      formatMM(opts.depthMM, lang),
    );
    // Die zweite Kette muss hinter der ersten Maßzahl liegen. In der Draufsicht stehen
    // beide nebeneinander in der Bildebene — ein fester Kettenabstand wäre schmaler als
    // die Zahl und beide Maße würden sich überdecken.
    depthChain(
      box.min.z,
      box.max.z,
      gap + labelH * 0.9 + nominalWidth + labelH * 0.4,
      2,
      formatMM((box.max.z - box.min.z) * 1000, lang),
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(seg.points, 3));
  const lines = new THREE.LineSegments(
    geometry,
    // depthTest aus: Maßlinien gehören als Overlay über das Bauteil, sonst verschwinden
    // sie in der Perspektive hinter Rahmen und Böden.
    new THREE.LineBasicMaterial({ color: DIM_COLOR, depthTest: false, depthWrite: false, transparent: true }),
  );
  lines.renderOrder = 10;
  group.add(lines);

  return group;
}

/** Gibt Geometrien, Materialien und Label-Texturen der Bemaßung frei. */
export function disposeDimensions(group: THREE.Group) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
    if ((mesh as unknown as THREE.LineSegments).geometry) (mesh as unknown as THREE.LineSegments).geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      const map = (material as THREE.SpriteMaterial).map;
      if (map) map.dispose();
      material.dispose();
    }
  });
}
