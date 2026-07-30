# META CLIP — Web configurator

A self-contained implementation of `META-CLIP-Konfigurator-Web.html`, imported
from the Claude Design project **3D Konfigurator UI Mobile** (web/desktop
layout). It configures a META CLIP boltless shelving system and updates the
price, availability, summary and bill of materials live.

## Run it

No build step — open `index.html` in a browser (or serve the folder):

```bash
python3 -m http.server 8080   # then visit http://localhost:8080
```

Serving over HTTP (rather than `file://`) is recommended so the local fonts
load without cross-origin quirks.

## What's here

```
cpq-configurator/
├── index.html              ← the configurator (markup + tokens + logic, vanilla JS)
├── assets/
│   ├── tokens.css          ← META design-system tokens + Frutiger @font-face
│   ├── meta-logo-red.png   ← official wordmark (red variant, from the DS Logo component)
│   └── fonts/              ← Frutiger LT Com (Roman/Bold/Black + Cn Bold/Black)
└── README.md
```

## Fidelity notes

- **Layout, type, spacing and copy** are ported 1:1 from the design's desktop
  view (`META-CLIP-Konfigurator-Web.html`), including the full DE/EN copy deck.
- **Pricing and BOM** reproduce the design's `dc-script` exactly (frame / shelf
  / foot-plate / rear-panel formulas, the `LASTF` load factors, the coating
  multiplier `k`, weight and overall-length maths). Verified against the design:
  the default config resolves to **733,20 € net · 872,51 € incl. VAT**.
- **Design-system components** (`Logo`, `Button`, `Alert`) are reproduced from
  the META Design System bundle; brand rules are austere — one accent (META
  Red `#ff0002`), squared corners, hairline rules, no shadows.
- **Control style toggle** (`Regler` / `Auswahl`) exposes the design's `mode`
  prop (sliders vs. chips) as a header segmented control; default is sliders.
- **3D slot**: the design leaves an `image-slot` for a render. Here it is filled
  with a live line-drawing schematic (perspective / front / top) that reflects
  bays, shelves and dimensions — drop a real render in its place when available.
