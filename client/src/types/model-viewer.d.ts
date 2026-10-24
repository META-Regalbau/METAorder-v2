import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        ar?: boolean;
        "ar-modes"?: string;
        "camera-controls"?: boolean;
        "touch-action"?: string;
        /** "fixed": AR in Originalgröße, nicht skalierbar (Regalplaner) */
        "ar-scale"?: string;
        "ar-placement"?: string;
        "shadow-intensity"?: string;
        alt?: string;
      };
    }
  }
}

export {};
