/**
 * Handy und Tablet: Die rechte Leiste "Schnellbearbeitung" stand offen und war fest 360 px breit -
 * bei 390 px blieben 48 px fuer den Inhalt, am Tablet (768-1024 px) 150-400 px. In der Kopfzeile lagen
 * Mandant, Sprache, Benachrichtigungen, Design und Nutzermenue (Abmelden!) ausserhalb des Bildschirms.
 * - rechte Leiste unter 1280 px als Panel ueber dem Inhalt, startet geschlossen, Knopf in der Kopfzeile
 * - Kopfzeile unter 1280 px: Mandant, Sprache, Design und Rolle im Nutzermenue (bei 1024 px ragten sonst 6 Elemente ueber)
 * - Design (hell/dunkel) als gemeinsamer Zustand, beim Start gesetzt
 * Statische Pruefungen der Verdrahtung; Design-Zustand mit nachgebildetem Browser.
 * Ausführung: npm test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("Design hell/dunkel: gemeinsamer Zustand", () => {
  let classes: Set<string>;
  let store: Record<string, string>;
  let events: EventTarget;

  beforeEach(() => {
    classes = new Set();
    store = {};
    events = new EventTarget();
    vi.stubGlobal("document", {
      documentElement: {
        classList: {
          contains: (c: string) => classes.has(c),
          toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c), on),
        },
      },
    });
    vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) });
    vi.stubGlobal("window", events);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("beim Start: gemerktes Design setzen", async () => {
    const { applyStoredThemeMode } = await import("../../client/src/hooks/useThemeMode");
    store.theme = "dark";
    applyStoredThemeMode();
    expect(classes.has("dark")).toBe(true);
    store.theme = "light";
    applyStoredThemeMode();
    expect(classes.has("dark")).toBe(false);
  });

  it("umschalten: Klasse, gemerkt, alle Schalter benachrichtigt", async () => {
    const { setThemeMode } = await import("../../client/src/hooks/useThemeMode");
    let notified = 0;
    events.addEventListener("metaorder-theme-change", () => notified++);
    setThemeMode("dark");
    expect([classes.has("dark"), store.theme, notified]).toEqual([true, "dark", 1]);
    setThemeMode("light");
    expect([classes.has("dark"), store.theme, notified]).toEqual([false, "light", 2]);
  });

  it("main.tsx setzt das Design vor dem ersten Zeichnen; ThemeToggle ohne eigenen Zustand", () => {
    const main = read("client/src/main.tsx");
    expect(main.indexOf("applyStoredThemeMode();")).toBeGreaterThan(-1);
    expect(main.indexOf("applyStoredThemeMode();")).toBeLessThan(main.indexOf("createRoot("));
    const toggle = read("client/src/components/ThemeToggle.tsx");
    expect(toggle).toContain("useThemeMode()");
    expect(toggle).not.toContain("useState");
  });
});

describe("rechte Leiste unter 1280 px", () => {
  const sidebar = read("client/src/components/RightSidebar.tsx");
  const context = read("client/src/components/RightSidebarContext.tsx");

  it("unter 1280 px Panel ueber dem Inhalt (Sheet), breiter Leiste daneben", () => {
    expect(sidebar).toContain("const asOverlay = useMediaQuery(COMPACT_LAYOUT_QUERY);");
    expect(sidebar).toMatch(/if \(asOverlay\) \{\s*return \(\s*<Sheet open=\{mobileOpen\} onOpenChange=\{setMobileOpen\}>/);
    // CSS-Klasse und Abfrage muessen zusammenpassen: xl = 1280 px
    expect(sidebar).toMatch(/<aside[\s\S]*className=\{`hidden xl:block /);
    expect(read("client/src/hooks/useMediaQuery.ts")).toContain('COMPACT_LAYOUT_QUERY = "(max-width: 1279px)"');
  });

  it("startet als Panel geschlossen, Zustand der Leiste daneben bleibt gemerkt", () => {
    expect(context).toContain("const [mobileOpen, setMobileOpen] = useState(false);");
    expect(context).toContain("localStorage.setItem(STORAGE_KEY, JSON.stringify({ isOpen }));");
    expect(context).not.toMatch(/setItem\([^)]*mobileOpen/);
  });

  it("Knopf in der Kopfzeile nur unter 1280 px und nur mit Ticket-Recht", () => {
    expect(read("client/src/components/RightSidebarToggle.tsx")).toContain('className="xl:hidden"');
    expect(read("client/src/components/TopBar.tsx")).toContain("{canViewTickets && <RightSidebarToggle />}");
    expect(read("client/src/App.tsx")).toContain("canViewTickets={Boolean(user.permissions?.viewTickets)}");
  });
});

describe("Kopfzeile unter 1280 px", () => {
  const topBar = read("client/src/components/TopBar.tsx");

  it("Mandant, Sprache, Design und Rolle erst ab 1280 px in der Kopfzeile", () => {
    const desktopBlocks = topBar.split('<div className="hidden xl:flex items-center gap-3">').slice(1).map((b) => b.split("</div>\n        <")[0]);
    expect(desktopBlocks.join("\n")).toMatch(/select-tenant-topbar[\s\S]*<LanguageSwitcher \/>/);
    expect(desktopBlocks.join("\n")).toMatch(/<ThemeToggle \/>[\s\S]*badge-user-role/);
  });

  it("dafuer im Nutzermenue: Mandant, Sprache, Design", () => {
    expect(topBar).toContain("const compactHeader = useMediaQuery(COMPACT_LAYOUT_QUERY);");
    const menu = topBar.slice(topBar.indexOf("{compactHeader && ("));
    expect(menu).toContain("<DropdownMenuRadioGroup value={selectedTenantId} onValueChange={changeTenant}>");
    expect(menu).toContain("onValueChange={(code) => changeLanguage(i18n, code)}");
    expect(menu).toContain("onClick={theme.toggle}");
  });

  it("Nutzermenue hat ohne sichtbaren Namen einen Namen, Titel und Abstaende schrumpfen", () => {
    expect(topBar).toMatch(/aria-label=\{username\}\s*data-testid="button-user-menu"/);
    expect(topBar).toContain('<h1 className="hidden xl:block text-xl font-semibold">');
    expect(topBar).toContain("px-3 md:px-6");
    expect(read("client/src/App.tsx")).toContain("p-4 md:p-6");
  });
});
