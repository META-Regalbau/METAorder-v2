/**
 * CPQ Scene Builder - builds 3D scene from config using placement rules
 * Uses same BOM logic for matching mappings, computes positions for Ständer, Träger, Böden
 */

import fs from "fs";
import path from "path";
import type { CpqComponentType, CpqProductMapping } from "@shared/schema";
import { resolveBillOfMaterials, type GetProductFn } from "./cpqBillOfMaterials";
import type { ConfigContext } from "./ruleEvaluator";

export type SceneInstance = {
  productMappingId: string;
  shopwareProductNumber: string;
  glbUrl: string | null;
  position: { x: number; y: number; z: number };
  scale?: number;
  rotation?: { x: number; y: number; z: number };
  componentRole: string;
  instanceIndex: number;
};

const ROLE_NORMALIZE: Record<string, string> = {
  frame: "frame",
  steher: "frame",
  ständer: "frame",
  beam: "beam",
  traverse: "beam",
  träger: "beam",
  shelf: "shelf",
  boden: "shelf",
  böden: "shelf",
};

function normalizeRole(role: string): string {
  const r = role.toLowerCase().trim();
  if (ROLE_NORMALIZE[r]) return ROLE_NORMALIZE[r];
  if (r.includes("ständer") || r.includes("steher")) return "frame";
  if (r.includes("träger") || r.includes("traverse")) return "beam";
  if (r.includes("boden") || r.includes("böden")) return "shelf";
  return r;
}

const CPQ_GLB_PATH = process.env.CPQ_GLB_PATH || path.resolve(process.cwd(), "client", "public", "cpq-models");

/** Hängt mtime als Cache-Bust-Parameter an cpq-models URLs */
function withCacheBust(url: string): string {
  if (!url.startsWith("/cpq-models/")) return url;
  const base = url.split("?")[0];
  const filename = base.replace("/cpq-models/", "");
  try {
    const fullPath = path.join(CPQ_GLB_PATH, filename);
    const stat = fs.statSync(fullPath);
    const mtime = Math.floor(stat.mtimeMs / 1000);
    return `${base}?v=${mtime}`;
  } catch {
    return url;
  }
}

function resolveGlbUrl(
  productNumber: string,
  geometryGlbUrl: string | null | undefined,
  manufacturerNumber?: string | null
): string | null {
  let raw: string | null = null;
  if (geometryGlbUrl) {
    if (geometryGlbUrl.startsWith("http") || geometryGlbUrl.startsWith("/")) {
      raw = geometryGlbUrl;
    } else {
      raw = `/${geometryGlbUrl}`.replace(/^\/\/+/, "/");
    }
  } else {
    // Fallback: GLB-Dateien oft nach ManufacturerNr (10023_VZK.glb) oder GTIN_ManufNr_... (4026212007886_10023_xyz.glb)
    if (!fs.existsSync(CPQ_GLB_PATH)) return null;
    const glbFiles = fs.readdirSync(CPQ_GLB_PATH).filter((f) => f.endsWith(".glb"));
    const tryMatchPrefix = (pn: string) => {
      const norm = String(pn || "").trim();
      if (!norm) return null;
      return glbFiles.find((f) => f.startsWith(norm) || f.startsWith(norm.replace(/^0+/, "")));
    };
    const tryMatchManufNr = (mfr: string) => {
      const norm = String(mfr || "").trim();
      if (!norm) return null;
      return glbFiles.find((f) => f.startsWith(norm) || f.startsWith(norm.replace(/^0+/, "")) || f.includes(`_${norm}_`) || f.endsWith(`_${norm}.glb`));
    };
    const match = tryMatchManufNr(manufacturerNumber ?? "") || tryMatchPrefix(manufacturerNumber ?? "") || tryMatchPrefix(productNumber);
    raw = match ? `/cpq-models/${match}` : null;
  }
  return raw ? withCacheBust(raw) : null;
}

export async function buildScene(
  systemId: string,
  config: ConfigContext,
  componentTypes: CpqComponentType[],
  mappings: CpqProductMapping[],
  rules: any[],
  getProduct: GetProductFn,
  getGeometry: (productMappingId: string) => Promise<{ glbAssetUrl?: string | null } | undefined>
): Promise<{ components: SceneInstance[]; config: ConfigContext }> {
  const bom = await resolveBillOfMaterials(systemId, config, componentTypes, mappings, rules, getProduct);
  const instances: SceneInstance[] = [];

  const fieldCount = (config.field_count as number) ?? 1;
  const levelCount = (config.level_count as number) ?? 2;
  const fieldWidth = (config.width as number) ?? 1000;
  const height = (config.height as number) ?? 2000;
  const depth = (config.depth as number) ?? 600;
  const levelPitch = height / Math.max(levelCount, 1); // Ebenenabstand mm

  const mappingsByProductNumber = new Map<string, CpqProductMapping>();
  for (const m of mappings) {
    if (m.status === "active") mappingsByProductNumber.set(m.shopwareProductNumber, m);
  }

  for (const item of bom.items) {
    const mapping = mappingsByProductNumber.get(item.productNumber);
    if (!mapping) continue;

    const role = componentTypes.find((ct) => ct.id === mapping.componentTypeId)?.role ?? "";
    const normRole = normalizeRole(role);

    const geometry = await getGeometry(mapping.id);
    const glbUrl = resolveGlbUrl(item.productNumber, geometry?.glbAssetUrl, item.manufacturerNumber);

    if (normRole === "frame") {
      for (let i = 0; i < item.quantity; i++) {
        instances.push({
          productMappingId: mapping.id,
          shopwareProductNumber: item.productNumber,
          glbUrl,
          position: { x: i * fieldWidth, y: 0, z: 0 },
          componentRole: "frame",
          instanceIndex: i,
        });
      }
    } else if (normRole === "shelf") {
      let idx = 0;
      for (let level = 0; level < levelCount; level++) {
        for (let field = 0; field < fieldCount; field++) {
          if (idx >= item.quantity) break;
          instances.push({
            productMappingId: mapping.id,
            shopwareProductNumber: item.productNumber,
            glbUrl,
            position: {
              x: field * fieldWidth + fieldWidth / 2,
              y: level * levelPitch,
              z: 0,
            },
            componentRole: "shelf",
            instanceIndex: idx,
          });
          idx++;
        }
      }
    } else if (normRole === "beam") {
      let idx = 0;
      // 2 Träger pro Ebene pro Feld (vorne + hinten)
      for (let level = 0; level < levelCount; level++) {
        for (let field = 0; field < fieldCount; field++) {
          for (const zOffset of [0, depth]) {
            if (idx >= item.quantity) break;
            instances.push({
              productMappingId: mapping.id,
              shopwareProductNumber: item.productNumber,
              glbUrl,
              position: {
                x: field * fieldWidth,
                y: level * levelPitch,
                z: zOffset,
              },
              componentRole: "beam",
              instanceIndex: idx,
            });
            idx++;
          }
        }
      }
    }
  }

  // Fallback: BOM leer (z.B. Regeln blocken) → mindestens ersten Ständer mit GLB anzeigen
  if (instances.length === 0 && mappings.length > 0) {
    const frameCt = componentTypes.find((ct) => normalizeRole(ct.role ?? ct.name ?? "") === "frame");
    if (frameCt) {
      const frameMappings = mappings.filter((m) => m.status === "active" && m.componentTypeId === frameCt.id);
      for (const m of frameMappings) {
        const geometry = await getGeometry(m.id);
        const product = getProduct(m.shopwareProductNumber) as { manufacturerNumber?: string } | undefined;
        const glbUrl = resolveGlbUrl(m.shopwareProductNumber, geometry?.glbAssetUrl, product?.manufacturerNumber);
        if (glbUrl) {
          instances.push({
            productMappingId: m.id,
            shopwareProductNumber: m.shopwareProductNumber,
            glbUrl,
            position: { x: 0, y: 0, z: 0 },
            componentRole: "frame",
            instanceIndex: 0,
          });
          break;
        }
      }
    }
    // Kein Frame mit GLB? Beliebiges Mapping mit GLB als Vorschau
    if (instances.length === 0) {
      for (const m of mappings) {
        if (m.status !== "active") continue;
        const geometry = await getGeometry(m.id);
        const product = getProduct(m.shopwareProductNumber) as { manufacturerNumber?: string } | undefined;
        const glbUrl = resolveGlbUrl(m.shopwareProductNumber, geometry?.glbAssetUrl, product?.manufacturerNumber);
        if (glbUrl) {
          instances.push({
            productMappingId: m.id,
            shopwareProductNumber: m.shopwareProductNumber,
            glbUrl,
            position: { x: 0, y: 0, z: 0 },
            componentRole: componentTypes.find((ct) => ct.id === m.componentTypeId)?.role ?? "frame",
            instanceIndex: 0,
          });
          break;
        }
      }
    }
  }

  return { components: instances, config };
}
