/**
 * Raumplanung (Phase 1): Raum definieren (Länge/Breite/Höhe) und die
 * CPQ-Konfigurationen eines Angebots per Drag & Drop in einer Draufsicht
 * platzieren. Wandkollisionen und Mindestabstände zwischen Regalen werden
 * clientseitig live verhindert und beim Speichern serverseitig verbindlich
 * geprüft (POST/PUT /api/offers/:id/room-layout).
 *
 * Öffnet sich als eigene Seite/Tab pro Angebot (wie der CPQ-Konfigurator).
 * Beim Speichern wird zusätzlich ein Offscreen-3D-Snapshot erzeugt (best-effort,
 * blockiert das Speichern nicht) und im Raum-Layout abgelegt — die
 * Raumplanung-Seite im Angebots-PDF zeigt genau dieses Bild (Phase 3).
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  placementRect,
  validateRoomPlacements,
  isPlacementValid,
  findFreeSpot,
  computeClearances,
  computeAutoFaceRotation,
  wallFeatureGeometry,
  wallLengthMmFor,
  type RoomFootprintMm,
  type RoomPlacement,
  type CpqRoomRotationDeg,
  type RoomRect,
  type RoomWall,
  type RoomWallFeature,
  type RoomWallFeatureType,
} from "@/lib/roomPlannerGeometry";
import "@/styles/metaAdmin.css";
import FullscreenViewport from "@/components/FullscreenViewport";

// Lazy: three.js/react-three-fiber + GLBs only load once the user actually opens the 3D view.
const RoomScene3D = lazy(() => import("./metaClip/RoomScene3D"));

// crypto.randomUUID() existiert nur in "secure contexts" (HTTPS oder localhost) — im internen
// Netz wird die App teils über eine LAN-IP/Hostname per HTTP aufgerufen, wo die Methode fehlt.
// Ein daraus resultierender TypeError beim Anlegen eines Wandelements (kein Error-Boundary in
// der App) würde den ganzen React-Baum unmounten -> weißer Bildschirm. Fallback macht die
// ID-Erzeugung unabhängig vom Secure-Context (nur lokale Eindeutigkeit nötig, keine Kryptografie).
function generateWallFeatureId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type RoomConfiguration = { configKey: string; name: string; footprint: RoomFootprintMm };

type RoomLayoutRow = {
  id: string;
  shopwareOfferId: string;
  name: string | null;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  minSpacingMm: number | null;
  placements: RoomPlacement[];
  wallFeatures: RoomWallFeature[];
};

type RoomLayoutResponse = {
  layout: RoomLayoutRow | null;
  defaultMinSpacingMm: number;
  configurations: RoomConfiguration[];
};

const CANVAS_MAX_W = 880;
const CANVAS_MAX_H = 540;
const COLORS = ["#c0392b", "#2c6e8f", "#2e7d4f", "#a06b1f", "#6b4c9a", "#1f6f6f"];
/** Platz außerhalb des Raum-Rechtecks für die Bemaßungslinien (Länge oben, Breite links). */
const DIM_PAD = 30;

function nextRotation(r: CpqRoomRotationDeg): CpqRoomRotationDeg {
  return ((r + 90) % 360) as CpqRoomRotationDeg;
}

/**
 * Vorderseiten-Markierung: kleines Dreieck, das aus der Kante herausragt, die bei der
 * jeweiligen Rotation als "vorne" gilt. Konvention (im Uhrzeigersinn mit der Rotation
 * mitgedreht, beginnend bei 0° = Süd/unten): 0°→unten, 90°→links, 180°→oben, 270°→rechts.
 * Rein visuelle 2D-Konvention (das Regal selbst ist vorne/hinten symmetrisch) — zeigt aber
 * konsistent, dass z. B. 0° und 180° trotz gleicher Bounding-Box unterschiedlich ausgerichtet sind.
 */
function FrontMarker({ rect, rotationDeg, scale, color }: { rect: RoomRect; rotationDeg: CpqRoomRotationDeg; scale: number; color: string }) {
  const midX = (rect.x0 + rect.x1) / 2;
  const midY = (rect.y0 + rect.y1) / 2;
  let ex: number, ey: number, nx: number, ny: number;
  if (rotationDeg === 0) { ex = midX; ey = rect.y1; nx = 0; ny = 1; }
  else if (rotationDeg === 90) { ex = rect.x0; ey = midY; nx = -1; ny = 0; }
  else if (rotationDeg === 180) { ex = midX; ey = rect.y0; nx = 0; ny = -1; }
  else { ex = rect.x1; ey = midY; nx = 1; ny = 0; }

  const px = ex * scale;
  const py = ey * scale;
  const tipLen = 9;
  const halfBase = 7;
  const tx = -ny;
  const ty = nx;
  const tipX = px + nx * tipLen;
  const tipY = py + ny * tipLen;
  const b1x = px - tx * halfBase;
  const b1y = py - ty * halfBase;
  const b2x = px + tx * halfBase;
  const b2y = py + ty * halfBase;
  return (
    <polygon
      points={`${tipX},${tipY} ${b1x},${b1y} ${b2x},${b2y}`}
      fill={color}
      stroke="var(--meta-white)"
      strokeWidth={0.75}
      style={{ pointerEvents: "none" }}
    />
  );
}

const WALL_LABELS: Record<RoomWall, string> = { north: "Nord (oben)", south: "Süd (unten)", east: "Ost (rechts)", west: "West (links)" };
const WALL_FEATURE_TYPE_LABELS: Record<RoomWallFeatureType, string> = { door: "Tür", window: "Fenster", gate: "Tor" };

/**
 * Rein stilisierte Darstellung einer Wandöffnung: die Wandlinie wird an der
 * Öffnung "gelöscht" (Überzeichnen mit der Raum-Hintergrundfarbe) und je nach
 * Typ ein Tür-Schwenk, Fenster-Strich oder Tor-Balken darübergezeichnet.
 * Ohne Kollisionsprüfung — reine Visualisierung, wie vom Nutzer gewünscht.
 */
function WallFeatureMark({
  feature,
  room,
  scale,
  isSelected,
  onPointerDown,
}: {
  feature: RoomWallFeature;
  room: { lengthMm: number; widthMm: number };
  scale: number;
  isSelected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const geo = wallFeatureGeometry(feature, room);
  const p1x = geo.p1.x * scale, p1y = geo.p1.y * scale;
  const p2x = geo.p2.x * scale, p2y = geo.p2.y * scale;
  const erase = <line x1={p1x} y1={p1y} x2={p2x} y2={p2y} stroke="var(--meta-mist)" strokeWidth={4} />;

  let decorative: JSX.Element;
  if (feature.type === "door") {
    const leafX = (geo.p1.x + geo.inward.x * feature.widthMm) * scale;
    const leafY = (geo.p1.y + geo.inward.y * feature.widthMm) * scale;
    const r = feature.widthMm * scale;
    decorative = (
      <>
        <line x1={p1x} y1={p1y} x2={leafX} y2={leafY} stroke="var(--fg-1)" strokeWidth={1.25} />
        <path d={`M ${leafX} ${leafY} A ${r} ${r} 0 0 ${geo.sweepFlag} ${p2x} ${p2y}`} fill="none" stroke="var(--fg-3)" strokeWidth={1} strokeDasharray="2,2" />
      </>
    );
  } else if (feature.type === "window") {
    const dx = p2x - p1x, dy = p2y - p1y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = -dy / len, ty = dx / len;
    const tick = 4;
    decorative = (
      <>
        <line x1={p1x} y1={p1y} x2={p2x} y2={p2y} stroke="#2c6e8f" strokeWidth={2.5} />
        <line x1={p1x - tx * tick} y1={p1y - ty * tick} x2={p1x + tx * tick} y2={p1y + ty * tick} stroke="#2c6e8f" strokeWidth={1.5} />
        <line x1={p2x - tx * tick} y1={p2y - ty * tick} x2={p2x + tx * tick} y2={p2y + ty * tick} stroke="#2c6e8f" strokeWidth={1.5} />
      </>
    );
  } else {
    decorative = <line x1={p1x} y1={p1y} x2={p2x} y2={p2y} stroke="#a06b1f" strokeWidth={3.5} strokeDasharray="6,3" />;
  }

  return (
    <g>
      <g style={{ pointerEvents: "none" }}>
        {erase}
        {decorative}
      </g>
      {/* Unsichtbarer/hervorgehobener Ziehgriff entlang der Öffnung — breiter als die
          Dekorlinien, damit sich Tür/Fenster/Tor bequem per Ziehen entlang der Wand verschieben
          lassen, ohne exakt auf die dünne Linie treffen zu müssen. */}
      <line
        x1={p1x} y1={p1y} x2={p2x} y2={p2y}
        stroke={isSelected ? "var(--meta-red)" : "transparent"}
        strokeOpacity={isSelected ? 0.3 : 0}
        strokeWidth={16}
        strokeLinecap="round"
        style={{ cursor: "grab", pointerEvents: "stroke" }}
        onPointerDown={onPointerDown}
      />
    </g>
  );
}

/** Bemaßungslinie mit Endstrichen und mittigem Maß-Label (mm) — für Raum-, Regal- und Abstandsmaße. */
function DimensionLine({ x1, y1, x2, y2, label, color = "var(--fg-3)" }: { x1: number; y1: number; x2: number; y2: number; label: string; color?: string }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const tick = 5;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const labelW = Math.max(26, label.length * 5.6 + 6);
  return (
    <g style={{ pointerEvents: "none" }}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1} />
      <line x1={x1 - px * tick} y1={y1 - py * tick} x2={x1 + px * tick} y2={y1 + py * tick} stroke={color} strokeWidth={1} />
      <line x1={x2 - px * tick} y1={y2 - py * tick} x2={x2 + px * tick} y2={y2 + py * tick} stroke={color} strokeWidth={1} />
      <rect x={midX - labelW / 2} y={midY - 7} width={labelW} height={14} fill="var(--meta-white)" opacity={0.92} />
      <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={9.5} fill={color}>{label}</text>
    </g>
  );
}

export default function RoomPlannerPage() {
  const offerId = useMemo(() => new URLSearchParams(window.location.search).get("offerId"), []);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<RoomLayoutResponse>({
    queryKey: [`/api/offers/${offerId}/room-layout`],
    enabled: !!offerId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/offers/${offerId}/room-layout`);
      return res.json();
    },
  });

  // Nur für die 3D-Ansicht: liefert die rohe CPQ-ConfigContext (field_count/width/depth/height/…)
  // je Konfiguration, die die schlanke room-layout-Antwort bewusst nicht mitschickt.
  const { data: offerDetail } = useQuery<{ lineItems: Array<{ id: string; isConfigurationGroup?: boolean; cpqConfig?: Record<string, unknown> | null }> }>({
    queryKey: [`/api/offers/${offerId}`],
    enabled: !!offerId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/offers/${offerId}`);
      return res.json();
    },
  });

  const [show3D, setShow3D] = useState(false);

  const [lengthMm, setLengthMm] = useState(6000);
  const [widthMm, setWidthMm] = useState(4000);
  const [heightMm, setHeightMm] = useState(2500);
  const [minSpacingMm, setMinSpacingMm] = useState(100);
  const [roomName, setRoomName] = useState("");
  const [placements, setPlacements] = useState<RoomPlacement[]>([]);
  const [wallFeatures, setWallFeatures] = useState<RoomWallFeature[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedWallFeatureId, setSelectedWallFeatureId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const [newFeatureWall, setNewFeatureWall] = useState<RoomWall>("north");
  const [newFeatureType, setNewFeatureType] = useState<RoomWallFeatureType>("door");
  const [newFeatureOffsetMm, setNewFeatureOffsetMm] = useState(0);
  const [newFeatureWidthMm, setNewFeatureWidthMm] = useState(900);

  useEffect(() => {
    if (!data || initialized) return;
    if (data.layout) {
      setLengthMm(data.layout.lengthMm);
      setWidthMm(data.layout.widthMm);
      setHeightMm(data.layout.heightMm);
      setMinSpacingMm(data.layout.minSpacingMm ?? data.defaultMinSpacingMm);
      setRoomName(data.layout.name ?? "");
      setPlacements(data.layout.placements ?? []);
      setWallFeatures(data.layout.wallFeatures ?? []);
    } else {
      setMinSpacingMm(data.defaultMinSpacingMm);
    }
    setInitialized(true);
  }, [data, initialized]);

  const isEditingWallFeature = selectedWallFeatureId !== null;

  const resetWallFeatureForm = () => {
    setSelectedWallFeatureId(null);
    setNewFeatureWall("north");
    setNewFeatureType("door");
    setNewFeatureOffsetMm(0);
    setNewFeatureWidthMm(900);
  };

  const selectWallFeatureForEdit = (f: RoomWallFeature) => {
    setSelectedKey(null);
    setSelectedWallFeatureId(f.id);
    setNewFeatureWall(f.wall);
    setNewFeatureType(f.type);
    setNewFeatureOffsetMm(f.offsetMm);
    setNewFeatureWidthMm(f.widthMm);
  };

  const commitWallFeature = () => {
    const wallLen = wallLengthMmFor(newFeatureWall, { lengthMm, widthMm });
    if (newFeatureWidthMm <= 0 || newFeatureOffsetMm < 0 || newFeatureOffsetMm + newFeatureWidthMm > wallLen) {
      toast({
        title: "Ungültige Position",
        description: `Diese Wand ist ${wallLen} mm lang — Position + Breite passen nicht hinein.`,
        variant: "destructive",
      });
      return;
    }
    if (selectedWallFeatureId) {
      setWallFeatures((prev) =>
        prev.map((f) =>
          f.id === selectedWallFeatureId
            ? { ...f, wall: newFeatureWall, type: newFeatureType, offsetMm: newFeatureOffsetMm, widthMm: newFeatureWidthMm }
            : f,
        ),
      );
      resetWallFeatureForm();
    } else {
      setWallFeatures((prev) => [
        ...prev,
        { id: generateWallFeatureId(), wall: newFeatureWall, type: newFeatureType, offsetMm: newFeatureOffsetMm, widthMm: newFeatureWidthMm },
      ]);
    }
  };

  const removeWallFeature = (id: string) => {
    setWallFeatures((prev) => prev.filter((f) => f.id !== id));
    if (selectedWallFeatureId === id) resetWallFeatureForm();
  };

  const configurations = data?.configurations ?? [];
  const footprintsByConfigKey = useMemo(() => {
    const m = new Map<string, RoomFootprintMm>();
    for (const c of configurations) m.set(c.configKey, c.footprint);
    return m;
  }, [configurations]);

  const configurations3D = useMemo(() => {
    const cpqByKey = new Map<string, Record<string, unknown>>();
    for (const li of offerDetail?.lineItems ?? []) {
      if (li.isConfigurationGroup && li.cpqConfig) cpqByKey.set(li.id, li.cpqConfig);
    }
    return configurations
      .map((c) => {
        const cpqConfig = cpqByKey.get(c.configKey);
        return cpqConfig ? { configKey: c.configKey, footprint: c.footprint, cpqConfig } : null;
      })
      .filter((c): c is { configKey: string; footprint: RoomFootprintMm; cpqConfig: Record<string, unknown> } => !!c);
  }, [configurations, offerDetail]);

  const placementsWithGeometry = placements.filter((p) => configurations3D.some((c) => c.configKey === p.configKey));

  const unplacedConfigurations = configurations.filter(
    (c) => !placements.some((p) => p.configKey === c.configKey),
  );

  const violations = useMemo(
    () => validateRoomPlacements({ lengthMm, widthMm }, placements, footprintsByConfigKey, minSpacingMm),
    [lengthMm, widthMm, placements, footprintsByConfigKey, minSpacingMm],
  );

  const scale = Math.max(0.001, Math.min(CANVAS_MAX_W / Math.max(1, lengthMm), CANVAS_MAX_H / Math.max(1, widthMm)));
  const canvasW = Math.round(lengthMm * scale);
  const canvasH = Math.round(widthMm * scale);
  // Extra Rand außerhalb des Raum-Rechtecks für die Bemaßungslinien (links breiter, damit
  // horizontal gesetzte mm-Labels an der senkrechten Breiten-Bemaßung nicht abgeschnitten werden).
  const PAD_TOP = 28, PAD_LEFT = 60, PAD_RIGHT = 12, PAD_BOTTOM = 12;
  const svgW = canvasW + PAD_LEFT + PAD_RIGHT;
  const svgH = canvasH + PAD_TOP + PAD_BOTTOM;

  const selectedClearances = useMemo(() => {
    if (!selectedKey) return null;
    const current = placements.find((p) => p.configKey === selectedKey);
    const footprint = footprintsByConfigKey.get(selectedKey);
    if (!current || !footprint) return null;
    const rect = placementRect(current, footprint);
    const others = placements
      .filter((p) => p.configKey !== selectedKey)
      .map((p) => {
        const fp = footprintsByConfigKey.get(p.configKey);
        return fp ? placementRect(p, fp) : null;
      })
      .filter((r): r is RoomRect => !!r);
    return { rect, clearances: computeClearances(rect, { lengthMm, widthMm }, others) };
  }, [selectedKey, placements, footprintsByConfigKey, lengthMm, widthMm]);

  const dragRef = useRef<{
    configKey: string;
    startClientX: number;
    startClientY: number;
    startXmm: number;
    startYmm: number;
  } | null>(null);

  const wallFeatureDragRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    startOffsetMm: number;
  } | null>(null);

  const otherRects = (excludeKey: string): Array<{ configKey: string; rect: RoomRect }> =>
    placements
      .filter((p) => p.configKey !== excludeKey)
      .map((p) => {
        const fp = footprintsByConfigKey.get(p.configKey);
        return fp ? { configKey: p.configKey, rect: placementRect(p, fp) } : null;
      })
      .filter((o): o is { configKey: string; rect: RoomRect } => !!o);

  const handlePointerDown = (e: React.PointerEvent, p: RoomPlacement) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    setSelectedKey(p.configKey);
    setSelectedWallFeatureId(null);
    dragRef.current = {
      configKey: p.configKey,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startXmm: p.xMm,
      startYmm: p.yMm,
    };
  };

  const handleWallFeaturePointerDown = (e: React.PointerEvent, f: RoomWallFeature) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    selectWallFeatureForEdit(f);
    wallFeatureDragRef.current = {
      id: f.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffsetMm: f.offsetMm,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      const footprint = footprintsByConfigKey.get(drag.configKey);
      const current = footprint ? placements.find((p) => p.configKey === drag.configKey) : undefined;
      if (footprint && current) {
        const deltaXmm = (e.clientX - drag.startClientX) / scale;
        const deltaYmm = (e.clientY - drag.startClientY) / scale;
        const rawX = Math.round(drag.startXmm + deltaXmm);
        const rawY = Math.round(drag.startYmm + deltaYmm);
        const others = otherRects(drag.configKey);
        const room = { lengthMm, widthMm };

        const tryBoth: RoomPlacement = { ...current, xMm: rawX, yMm: rawY };
        const tryX: RoomPlacement = { ...current, xMm: rawX, yMm: current.yMm };
        const tryY: RoomPlacement = { ...current, xMm: current.xMm, yMm: rawY };

        let next: RoomPlacement | null = null;
        if (isPlacementValid(room, tryBoth, footprint, others, minSpacingMm)) next = tryBoth;
        else if (isPlacementValid(room, tryX, footprint, others, minSpacingMm)) next = tryX;
        else if (isPlacementValid(room, tryY, footprint, others, minSpacingMm)) next = tryY;

        if (next) {
          // Autodrehung: näher als 50cm an einer Wand → Vorderseite automatisch von dieser
          // Wand wegdrehen (nur wenn die gedrehte Platzierung an dieser Stelle gültig bleibt —
          // Drehung kann bei Regalen mit Breite≠Tiefe den belegten Fußabdruck ändern).
          const autoRotation = computeAutoFaceRotation(next, footprint, room, others, minSpacingMm);
          const finalPlacement = autoRotation !== null ? { ...next, rotationDeg: autoRotation } : next;
          setPlacements((prev) => prev.map((p) => (p.configKey === drag.configKey ? finalPlacement : p)));
        }
      }
    }

    const wfDrag = wallFeatureDragRef.current;
    if (wfDrag) {
      const feature = wallFeatures.find((f) => f.id === wfDrag.id);
      if (feature) {
        // Offset läuft immer entlang der eigenen Wand (Nord/Süd: X-Achse, Ost/West: Y-Achse) —
        // ein Wandelement kann so nur innerhalb seiner Wand verschoben werden, nie auf eine andere.
        const isHorizontalWall = feature.wall === "north" || feature.wall === "south";
        const deltaMm = isHorizontalWall
          ? (e.clientX - wfDrag.startClientX) / scale
          : (e.clientY - wfDrag.startClientY) / scale;
        const wallLen = wallLengthMmFor(feature.wall, { lengthMm, widthMm });
        const rawOffset = Math.round(wfDrag.startOffsetMm + deltaMm);
        const clampedOffset = Math.max(0, Math.min(Math.max(0, wallLen - feature.widthMm), rawOffset));
        setWallFeatures((prev) => prev.map((f) => (f.id === wfDrag.id ? { ...f, offsetMm: clampedOffset } : f)));
        if (selectedWallFeatureId === wfDrag.id) setNewFeatureOffsetMm(clampedOffset);
      }
    }
  };

  const handlePointerUp = () => {
    dragRef.current = null;
    wallFeatureDragRef.current = null;
  };

  const addToRoom = (config: RoomConfiguration) => {
    const spot = findFreeSpot({ lengthMm, widthMm }, config.footprint, placements, footprintsByConfigKey, minSpacingMm);
    if (!spot) {
      toast({
        title: "Kein Platz gefunden",
        description: "Im Raum ist kein freier Platz für dieses Regal. Bitte Raum vergrößern oder andere Regale verschieben.",
        variant: "destructive",
      });
      return;
    }
    const initialPlacement: RoomPlacement = { configKey: config.configKey, xMm: spot.xMm, yMm: spot.yMm, rotationDeg: 0 };
    const autoRotation = computeAutoFaceRotation(
      initialPlacement,
      config.footprint,
      { lengthMm, widthMm },
      otherRects(config.configKey),
      minSpacingMm,
    );
    setPlacements((prev) => [...prev, autoRotation !== null ? { ...initialPlacement, rotationDeg: autoRotation } : initialPlacement]);
    setSelectedKey(config.configKey);
  };

  const removeFromRoom = (configKey: string) => {
    setPlacements((prev) => prev.filter((p) => p.configKey !== configKey));
    if (selectedKey === configKey) setSelectedKey(null);
  };

  const rotateSelected = () => {
    if (!selectedKey) return;
    const current = placements.find((p) => p.configKey === selectedKey);
    const footprint = footprintsByConfigKey.get(selectedKey);
    if (!current || !footprint) return;
    const candidate: RoomPlacement = { ...current, rotationDeg: nextRotation(current.rotationDeg) };
    const others = otherRects(selectedKey);
    if (!isPlacementValid({ lengthMm, widthMm }, candidate, footprint, others, minSpacingMm)) {
      toast({ title: "Drehung nicht möglich", description: "An dieser Position würde das Regal mit Wand oder Nachbarregal kollidieren.", variant: "destructive" });
      return;
    }
    setPlacements((prev) => prev.map((p) => (p.configKey === selectedKey ? candidate : p)));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Bestes Bemühen: ein Snapshot-Fehler (z. B. verlorener WebGL-Kontext) darf
      // das Speichern des Layouts nicht blockieren — dann bleibt einfach das
      // vorherige (oder gar kein) Bild in der PDF-Raumplanung-Seite erhalten.
      let previewImageBase64: string | null | undefined = undefined;
      if (placementsWithGeometry.length > 0) {
        try {
          const { captureRoomCompositeImage } = await import("./metaClip/captureRoomImage");
          previewImageBase64 = await captureRoomCompositeImage(
            { lengthMm, widthMm, heightMm },
            placementsWithGeometry,
            configurations3D,
            wallFeatures,
          );
        } catch (e) {
          console.warn("[Raumplanung] 3D-Snapshot konnte nicht erzeugt werden:", e);
        }
      }
      const res = await apiRequest("PUT", `/api/offers/${offerId}/room-layout`, {
        name: roomName || null,
        lengthMm,
        widthMm,
        heightMm,
        minSpacingMm,
        placements,
        wallFeatures,
        ...(previewImageBase64 !== undefined ? { previewImageBase64 } : {}),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Raum-Layout gespeichert" });
      queryClient.invalidateQueries({ queryKey: [`/api/offers/${offerId}/room-layout`] });
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  if (!offerId) {
    return (
      <div className="madmin" style={{ padding: 48 }}>
        <div className="malert destructive">Kein Angebot angegeben (fehlender Parameter offerId).</div>
      </div>
    );
  }

  if (isLoading || !initialized) {
    return (
      <div className="madmin" style={{ padding: 48, color: "var(--fg-3)" }}>
        Lade Raumplanung…
      </div>
    );
  }

  const colorFor = (configKey: string) => COLORS[configurations.findIndex((c) => c.configKey === configKey) % COLORS.length];

  return (
    <div className="madmin" style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <div className="mpage-head">
        <div>
          <span className="eyebrow">CPQ · Angebot {offerId}</span>
          <h1>Raumplanung</h1>
          <div className="desc">Regale im Raum platzieren, Wandabstand und Mindestabstand werden automatisch geprüft.</div>
        </div>
        <button type="button" className="mbtn primary" disabled={saveMutation.isPending || violations.length > 0} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? "Speichert…" : "Speichern"}
        </button>
      </div>

      {violations.length > 0 && (
        <div className="malert warning">
          <div className="malert-title">Ungültige Platzierung</div>
          {violations.map((v, i) => (
            <div key={i}>
              {v.type === "wall-collision" && `„${configurations.find((c) => c.configKey === v.configKey)?.name ?? v.configKey}“ ragt über die Raumgrenze hinaus.`}
              {v.type === "min-spacing" &&
                `Mindestabstand zwischen „${configurations.find((c) => c.configKey === v.configKeyA)?.name ?? v.configKeyA}“ und „${configurations.find((c) => c.configKey === v.configKeyB)?.name ?? v.configKeyB}“ unterschritten.`}
            </div>
          ))}
        </div>
      )}

      <div className="mcard">
        <div className="mcard-head">
          <div className="mcard-head-left">
            <p className="mcard-title">Raummaße</p>
          </div>
        </div>
        <div className="mcard-body">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="mfield-label">Bezeichnung</label>
              <input className="minput" style={{ width: 200 }} value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="z. B. Lagerhalle 1" />
            </div>
            <div>
              <label className="mfield-label">Länge (mm)</label>
              <input type="number" className="minput" style={{ width: 110 }} value={lengthMm} min={100} onChange={(e) => setLengthMm(Math.max(100, Number(e.target.value) || 0))} />
            </div>
            <div>
              <label className="mfield-label">Breite (mm)</label>
              <input type="number" className="minput" style={{ width: 110 }} value={widthMm} min={100} onChange={(e) => setWidthMm(Math.max(100, Number(e.target.value) || 0))} />
            </div>
            <div>
              <label className="mfield-label">Höhe (mm)</label>
              <input type="number" className="minput" style={{ width: 110 }} value={heightMm} min={100} onChange={(e) => setHeightMm(Math.max(100, Number(e.target.value) || 0))} />
            </div>
            <div>
              <label className="mfield-label">Mindestabstand Regale (mm)</label>
              <input type="number" className="minput" style={{ width: 110 }} value={minSpacingMm} min={0} onChange={(e) => setMinSpacingMm(Math.max(0, Number(e.target.value) || 0))} />
            </div>
          </div>
        </div>
      </div>

      <div className="mcard">
        <div className="mcard-head">
          <div className="mcard-head-left">
            <p className="mcard-title">Wandelemente</p>
            <span className="mcard-desc">Türen, Fenster und Tore — rein stilisiert, ohne Einfluss auf die Platzierungsprüfung. In der Draufsicht per Ziehen entlang der Wand verschiebbar.</span>
          </div>
        </div>
        <div className="mcard-body">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="mfield-label">Wand</label>
              <select className="minput" style={{ width: 140 }} value={newFeatureWall} onChange={(e) => setNewFeatureWall(e.target.value as RoomWall)}>
                {(Object.keys(WALL_LABELS) as RoomWall[]).map((w) => (
                  <option key={w} value={w}>{WALL_LABELS[w]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mfield-label">Typ</label>
              <select className="minput" style={{ width: 120 }} value={newFeatureType} onChange={(e) => setNewFeatureType(e.target.value as RoomWallFeatureType)}>
                {(Object.keys(WALL_FEATURE_TYPE_LABELS) as RoomWallFeatureType[]).map((t) => (
                  <option key={t} value={t}>{WALL_FEATURE_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mfield-label">Position ab Wandecke (mm)</label>
              <input type="number" className="minput" style={{ width: 120 }} value={newFeatureOffsetMm} min={0} onChange={(e) => setNewFeatureOffsetMm(Math.max(0, Number(e.target.value) || 0))} />
            </div>
            <div>
              <label className="mfield-label">Breite (mm)</label>
              <input type="number" className="minput" style={{ width: 110 }} value={newFeatureWidthMm} min={1} onChange={(e) => setNewFeatureWidthMm(Math.max(1, Number(e.target.value) || 0))} />
            </div>
            <button type="button" className="mbtn sm" onClick={commitWallFeature}>
              {isEditingWallFeature ? "Aktualisieren" : "Hinzufügen"}
            </button>
            {isEditingWallFeature && (
              <button type="button" className="mbtn sm ghost" onClick={resetWallFeatureForm}>Abbrechen</button>
            )}
          </div>

          {wallFeatures.length > 0 && (
            <div className="mlist" style={{ marginTop: 12 }}>
              {wallFeatures.map((f) => (
                <div
                  key={f.id}
                  className="mrow"
                  style={{
                    cursor: "pointer",
                    background: selectedWallFeatureId === f.id ? "var(--meta-mist)" : undefined,
                  }}
                  onClick={() => selectWallFeatureForEdit(f)}
                >
                  <div className="mrow-main">
                    <div className="mrow-title">{WALL_FEATURE_TYPE_LABELS[f.type]} — {WALL_LABELS[f.wall]}</div>
                    <div className="mrow-meta">ab {f.offsetMm} mm, Breite {f.widthMm} mm</div>
                  </div>
                  <button type="button" className="mbtn sm destructive" onClick={(e) => { e.stopPropagation(); removeWallFeature(f.id); }}>Entfernen</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mcard">
        <div className="mcard-head">
          <div className="mcard-head-left">
            <p className="mcard-title">Draufsicht</p>
            <span className="mcard-desc">▲ markiert die Vorderseite des Regals. Näher als 50cm an einer Wand dreht sich die Vorderseite automatisch von ihr weg.</span>
          </div>
          {selectedKey && (
            <div className="flex items-center gap-2">
              <button type="button" className="mbtn sm" onClick={rotateSelected}>Drehen (90°)</button>
              <button type="button" className="mbtn sm destructive" onClick={() => removeFromRoom(selectedKey)}>Aus Raum entfernen</button>
            </div>
          )}
        </div>
        <div className="mcard-body" style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <FullscreenViewport label="Draufsicht im Vollbild anzeigen" stretchContent={false} style={{ background: "var(--meta-mist)" }}>
          <svg
            width={svgW}
            height={svgH}
            style={{ background: "var(--meta-white)", touchAction: "none" }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <g transform={`translate(${PAD_LEFT}, ${PAD_TOP})`}>
              <rect x={0} y={0} width={canvasW} height={canvasH} fill="var(--meta-mist)" stroke="var(--meta-steel)" strokeWidth={1} />

              {/* Raummaße: Länge oben, Breite links — immer sichtbar */}
              <DimensionLine x1={0} y1={-14} x2={canvasW} y2={-14} label={`${lengthMm} mm`} />
              <DimensionLine x1={-14} y1={0} x2={-14} y2={canvasH} label={`${widthMm} mm`} />

              {wallFeatures.map((f) => (
                <WallFeatureMark
                  key={f.id}
                  feature={f}
                  room={{ lengthMm, widthMm }}
                  scale={scale}
                  isSelected={selectedWallFeatureId === f.id}
                  onPointerDown={(e) => handleWallFeaturePointerDown(e, f)}
                />
              ))}

              {placements.map((p) => {
                const footprint = footprintsByConfigKey.get(p.configKey);
                if (!footprint) return null;
                const rect = placementRect(p, footprint);
                const config = configurations.find((c) => c.configKey === p.configKey);
                const isSelected = selectedKey === p.configKey;
                const isInvalid = violations.some(
                  (v) =>
                    (v.type === "wall-collision" && v.configKey === p.configKey) ||
                    (v.type === "min-spacing" && (v.configKeyA === p.configKey || v.configKeyB === p.configKey)),
                );
                const color = colorFor(p.configKey);
                const cx = (rect.x0 + rect.x1) / 2 * scale;
                const cy = (rect.y0 + rect.y1) / 2 * scale;
                return (
                  <g
                    key={p.configKey}
                    onPointerDown={(e) => handlePointerDown(e, p)}
                    style={{ cursor: "grab" }}
                  >
                    <rect
                      x={rect.x0 * scale}
                      y={rect.y0 * scale}
                      width={(rect.x1 - rect.x0) * scale}
                      height={(rect.y1 - rect.y0) * scale}
                      fill={color}
                      fillOpacity={isSelected ? 0.35 : 0.2}
                      stroke={isInvalid ? "#c0392b" : color}
                      strokeWidth={isSelected || isInvalid ? 2.5 : 1.5}
                    />
                    <FrontMarker rect={rect} rotationDeg={p.rotationDeg} scale={scale} color={color} />
                    <text
                      x={cx}
                      y={cy - 6}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={11}
                      fill="var(--fg-1)"
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {config?.name ?? p.configKey}
                    </text>
                    <text
                      x={cx}
                      y={cy + 9}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={9.5}
                      fill="var(--fg-3)"
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {Math.round(rect.x1 - rect.x0)} × {Math.round(rect.y1 - rect.y0)} mm
                    </text>
                  </g>
                );
              })}

              {selectedClearances && (() => {
                const { rect, clearances } = selectedClearances;
                const ccx = (rect.x0 + rect.x1) / 2 * scale;
                const ccy = (rect.y0 + rect.y1) / 2 * scale;
                const dimColor = (toWall: boolean, distanceMm: number) =>
                  toWall ? "var(--fg-3)" : distanceMm < minSpacingMm ? "var(--meta-red)" : "#1e8e47";
                return (
                  <>
                    <DimensionLine
                      x1={ccx} y1={rect.y0 * scale}
                      x2={ccx} y2={(rect.y0 - clearances.top.distanceMm) * scale}
                      label={`${clearances.top.distanceMm} mm`}
                      color={dimColor(clearances.top.toWall, clearances.top.distanceMm)}
                    />
                    <DimensionLine
                      x1={ccx} y1={rect.y1 * scale}
                      x2={ccx} y2={(rect.y1 + clearances.bottom.distanceMm) * scale}
                      label={`${clearances.bottom.distanceMm} mm`}
                      color={dimColor(clearances.bottom.toWall, clearances.bottom.distanceMm)}
                    />
                    <DimensionLine
                      x1={rect.x0 * scale} y1={ccy}
                      x2={(rect.x0 - clearances.left.distanceMm) * scale} y2={ccy}
                      label={`${clearances.left.distanceMm} mm`}
                      color={dimColor(clearances.left.toWall, clearances.left.distanceMm)}
                    />
                    <DimensionLine
                      x1={rect.x1 * scale} y1={ccy}
                      x2={(rect.x1 + clearances.right.distanceMm) * scale} y2={ccy}
                      label={`${clearances.right.distanceMm} mm`}
                      color={dimColor(clearances.right.toWall, clearances.right.distanceMm)}
                    />
                  </>
                );
              })()}
            </g>
          </svg>
          </FullscreenViewport>

          <div style={{ minWidth: 220 }}>
            <p className="mfield-label" style={{ marginBottom: 8 }}>Noch nicht platziert</p>
            {unplacedConfigurations.length === 0 ? (
              <div className="mempty">{configurations.length === 0 ? "Dieses Angebot enthält noch keine Konfiguration." : "Alle Konfigurationen sind platziert."}</div>
            ) : (
              <div className="mlist">
                {unplacedConfigurations.map((c) => (
                  <div key={c.configKey} className="mrow">
                    <div className="mrow-main">
                      <div className="mrow-title">{c.name}</div>
                      <div className="mrow-meta">{Math.round(c.footprint.lengthMm)} × {Math.round(c.footprint.depthMm)} mm</div>
                    </div>
                    <button type="button" className="mbtn sm" onClick={() => addToRoom(c)}>Platzieren</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mcard">
        <div className="mcard-head">
          <div className="mcard-head-left">
            <p className="mcard-title">3D-Ansicht</p>
            <span className="mcard-desc">Drehbar (Ziehen) und zoombar (Scrollen), zeigt den aktuellen Stand der Planung.</span>
          </div>
          <button type="button" className="mbtn sm" onClick={() => setShow3D((v) => !v)}>
            {show3D ? "3D-Ansicht ausblenden" : "3D-Ansicht anzeigen"}
          </button>
        </div>
        {show3D && (
          <div className="mcard-body tight" style={{ height: 480 }}>
            {placementsWithGeometry.length === 0 ? (
              <div className="mempty" style={{ padding: 16 }}>
                Noch kein platziertes Regal mit vollständigen 3D-Daten. Regale im Raum platzieren, um die 3D-Ansicht zu sehen.
              </div>
            ) : (
              <FullscreenViewport label="3D-Ansicht im Vollbild anzeigen" style={{ width: "100%", height: "100%" }}>
                <Suspense fallback={<div className="mloading" style={{ padding: 16 }}>Lade 3D-Ansicht…</div>}>
                  <RoomScene3D
                    room={{ lengthMm, widthMm, heightMm }}
                    placements={placementsWithGeometry}
                    configurations={configurations3D}
                    wallFeatures={wallFeatures}
                  />
                </Suspense>
              </FullscreenViewport>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
