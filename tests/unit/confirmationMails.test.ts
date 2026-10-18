import { describe, expect, it } from "vitest";
import {
  NEWSLETTER_DOI_HTML,
  NEWSLETTER_DOI_PLAIN,
  buildFooterHtml,
  buildFooterPlain,
  duplicateDoiFlows,
  headerWithLogoAlt,
  type FlowLite,
} from "../../server/shopContent/confirmationMails";

const GUEST = "checkout.customer.double_opt_in_guest_order";
const REG = "checkout.customer.double_opt_in_registration";
const mailFlow = (id: string, eventName: string, createdAt: string, mailTemplateId = "tpl", active = true): FlowLite => ({
  id,
  name: id,
  eventName,
  active,
  createdAt,
  sequences: [{ actionName: "action.mail.send", config: { mailTemplateId } }],
});

describe("Doppelte Double-Opt-in-Flows", () => {
  it("schaltet je Ereignis den älteren Flow mit derselben Mail ab", () => {
    const flows = [
      mailFlow("x-gast", GUEST, "2024-04-09T04:53:23Z", "g"),
      mailFlow("gast", GUEST, "2026-07-27T13:41:16Z", "g"),
      mailFlow("x-reg", REG, "2024-04-09T04:53:23Z", "r"),
      mailFlow("reg", REG, "2026-07-27T13:40:59Z", "r"),
    ];
    expect(duplicateDoiFlows(flows).map((f) => f.id)).toEqual(["x-gast", "x-reg"]);
  });

  it("lässt inaktive Flows, andere Mails und Flows mit Bedingungen in Ruhe", () => {
    const withRule: FlowLite = {
      ...mailFlow("regel", GUEST, "2023-01-01T00:00:00Z", "g"),
      sequences: [{ actionName: null, config: [] }, { actionName: "action.mail.send", config: { mailTemplateId: "g" } }],
    };
    const flows = [
      mailFlow("neu", GUEST, "2026-07-27T00:00:00Z", "g"),
      mailFlow("alt-aus", GUEST, "2024-01-01T00:00:00Z", "g", false),
      mailFlow("andere-mail", GUEST, "2024-01-01T00:00:00Z", "h"),
      withRule,
      mailFlow("fremd", "newsletter.register", "2024-01-01T00:00:00Z", "g"),
    ];
    expect(duplicateDoiFlows(flows)).toEqual([]);
  });
});

describe("Newsletter-Double-Opt-in-Mail", () => {
  it("hat Knopf und Link zum Kopieren auf {{ url }}", () => {
    expect(NEWSLETTER_DOI_HTML).toContain('href="{{ url }}"');
    expect(NEWSLETTER_DOI_HTML).toContain("Anmeldung bestätigen</a>");
    expect(NEWSLETTER_DOI_PLAIN).toContain("{{ url }}");
  });

  it("nennt den Namen nur, wenn die Anmeldung einen mitbringt (Checkout-Checkbox schickt keinen)", () => {
    expect(NEWSLETTER_DOI_HTML).toContain("{% if newsletterRecipient.lastName %}");
    expect(NEWSLETTER_DOI_HTML).not.toContain("<h3>Hallo {{");
  });
});

describe("Mail-Fußzeile", () => {
  const base = "https://shop.meta-online.com";

  it("verlinkt Impressum, Datenschutz und AGB absolut statt über Platzhalter-IDs", () => {
    const html = buildFooterHtml(base);
    for (const p of ["impressum", "datenschutz", "agb"]) expect(html).toContain(`href="${base}/${p}"`);
    expect(html).not.toMatch(/page-id|seoUrl/);
  });

  it("nennt Registerangaben und die Bankverbindung je einmal", () => {
    for (const text of [buildFooterHtml(base), buildFooterPlain(base)]) {
      expect(text.match(/HRA 1551/g)).toHaveLength(1);
      expect(text.match(/Bankverbindung/g)).toHaveLength(1);
      expect(text).toContain("DE83 4667 0007 0554 4770 00");
    }
  });

  it("setzt alt nur an Logos ohne alt", () => {
    expect(headerWithLogoAlt('<div><img src="a.png" width="220px"></div>')).toBe('<div><img src="a.png" width="220px" alt="META Regalbau"></div>');
    expect(headerWithLogoAlt('<img src="a.png" alt="x" />')).toBe('<img src="a.png" alt="x" />');
  });
});
