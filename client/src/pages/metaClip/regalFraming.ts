/**
 * Kamera-Einpassung für die Regalansicht: stellt die Kamera so weit weg, dass der Aufbau
 * (inklusive Bemaßung) das Bild gerade ausfüllt — in der Höhe UND in der Breite.
 *
 * Vorher stand die Kamera in einem festen Vielfachen der Objektdiagonale. Das ignoriert
 * das Seitenverhältnis: in einem breiten Viewport begrenzte weiterhin die vertikale
 * Brennweite, das Regal blieb gleich groß und links und rechts wuchs nur leerer Rand.
 * Umgekehrt konnte bei einer langen Regalzeile das äußerste Maß seitlich rausfallen.
 *
 * Hier wird stattdessen aus den acht Eckpunkten der Bounding-Box der kleinste Abstand
 * berechnet, bei dem jede Ecke noch im Sichtkegel liegt.
 */
import * as THREE from "three";

/** Blickrichtung je Ansicht (von dort schaut die Kamera auf die Mitte). */
const VIEW_DIRECTION: Record<number, [number, number, number]> = {
  0: [1.3, 1.0, 1.7], // Perspektive
  1: [0, 0, 1], // Vorderansicht
  2: [0, 1, 0.0001], // Draufsicht (minimales Z, damit die Up-Achse eindeutig bleibt)
};

export function unionBox(objects: THREE.Object3D[]): THREE.Box3 {
  const box = new THREE.Box3();
  const one = new THREE.Box3();
  for (const object of objects) {
    object.updateMatrixWorld(true);
    box.union(one.setFromObject(object));
  }
  return box;
}

export type RegalCamera = {
  position: [number, number, number];
  target: [number, number, number];
  distance: number;
};

/**
 * @param aspect Breite/Höhe des Viewports. Ein breiter Viewport lässt die Kamera näher
 *               heran, weil horizontal mehr Platz ist — genau das macht die Darstellung
 *               auf einem breiten Bildschirm größer.
 * @param margin Sicherheitszuschlag, damit Maßzahlen (Sprites, deren Breite in der
 *               Bounding-Box nur genähert steckt) nicht am Rand kleben.
 */
export function cameraForView(
  box: THREE.Box3,
  view: number,
  fovDeg: number,
  aspect: number,
  margin = 1.08,
): RegalCamera {
  const center = box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(...(VIEW_DIRECTION[view] ?? VIEW_DIRECTION[0])).normalize();

  // Kamerabasis: für die Draufsicht ist die Welt-Y-Achse als Up unbrauchbar (parallel zur
  // Blickrichtung), dann dient Z als Ersatz.
  const worldUp = Math.abs(dir.y) > 0.999 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();

  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * Math.max(0.1, aspect);

  const corner = new THREE.Vector3();
  let distance = 0;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    corner.sub(center);
    // Kamera bei center + dir*d ⇒ Tiefe der Ecke = d − (Ecke·dir); sie ist sichtbar, wenn
    // |Ecke·right| ≤ Tiefe·tanH und |Ecke·up| ≤ Tiefe·tanV.
    const along = corner.dot(dir);
    distance = Math.max(
      distance,
      along + (Math.abs(corner.dot(right)) * margin) / tanH,
      along + (Math.abs(corner.dot(up)) * margin) / tanV,
    );
  }
  // Sehr flache Objekte in einer Achse: einen Mindestabstand halten, sonst sitzt die
  // Kamera bei einem Einzelregal in der Draufsicht praktisch auf dem Bauteil.
  distance = Math.max(distance, box.getSize(new THREE.Vector3()).length() * 0.35);

  const position = center.clone().addScaledVector(dir, distance);
  return {
    position: [position.x, position.y, position.z],
    target: [center.x, center.y, center.z],
    distance,
  };
}
