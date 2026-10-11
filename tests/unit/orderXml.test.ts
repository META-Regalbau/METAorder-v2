/**
 * Bestell-XML aus Mail-Anhängen (Mercateo/Unite schickt openTRANS mit, Live 11.10.2026).
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  extractLegacyFromOrderXml,
  isOrderRelevantXml,
  orderXmlToReadableText,
  parseOrderXml,
  parseXml,
  xmlToPlainText,
} from "../../server/extraction/orderXmlParser";
import { classifyXmlAttachment, partitionCommercialParts } from "../../server/commercial/commercialDraftAttachments";
import { parseEmlFile } from "../../server/email/emailParser";
import { extractPlainTextForDraft } from "../../server/extraction/documentTextExtraction";

const OPENTRANS_1 = `<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE ORDER SYSTEM "openTRANS_ORDER_1_0.dtd">
<ORDER version="1.0" type="standard">
  <ORDER_HEADER>
    <ORDER_INFO>
      <ORDER_ID>4525628622</ORDER_ID>
      <ORDER_DATE>2026-10-10T14:22:00+01:00</ORDER_DATE>
      <DELIVERY_DATE type="optional"><DELIVERY_START_DATE>2026-10-20</DELIVERY_START_DATE><DELIVERY_END_DATE>2026-10-24</DELIVERY_END_DATE></DELIVERY_DATE>
      <ORDER_PARTIES>
        <BUYER_PARTY><PARTY>
          <PARTY_ID type="buyer_specific">MERC-1</PARTY_ID>
          <PARTY_ID type="supplier_specific">20000042592</PARTY_ID>
          <ADDRESS>
            <NAME>Unite Procurement Deutschland AG</NAME>
            <CONTACT><CONTACT_NAME>Heike Eichler</CONTACT_NAME></CONTACT>
            <STREET>Museumsgasse 4-5</STREET><ZIP>06366</ZIP><CITY>Köthen</CITY><COUNTRY>Deutschland</COUNTRY><COUNTRY_CODED>DE</COUNTRY_CODED>
            <EMAIL>operations@mercateo.com</EMAIL>
          </ADDRESS>
        </PARTY></BUYER_PARTY>
        <SUPPLIER_PARTY><PARTY><ADDRESS><NAME>META-Regalbau GmbH &amp; Co. KG</NAME></ADDRESS></PARTY></SUPPLIER_PARTY>
        <INVOICE_PARTY><PARTY>
          <ADDRESS><NAME>Unite Procurement Deutschland AG</NAME><STREET>Museumsgasse 4-5</STREET><ZIP>06366</ZIP><CITY>Köthen</CITY><COUNTRY_CODED>DE</COUNTRY_CODED><EMAIL>invoice@mercateo.com</EMAIL></ADDRESS>
        </PARTY></INVOICE_PARTY>
        <SHIPMENT_PARTIES><DELIVERY_PARTY><PARTY>
          <ADDRESS>
            <NAME>Schäfer Logistik GmbH</NAME><NAME2>Wareneingang Tor 3</NAME2>
            <CONTACT><CONTACT_NAME>Jan Schäfer</CONTACT_NAME></CONTACT>
            <STREET>Rudolphstraße 1</STREET><ZIP>34821</ZIP><CITY>Gudensberg</CITY><COUNTRY_CODED>DE</COUNTRY_CODED>
            <PHONE>05603 4991-4453</PHONE>
          </ADDRESS>
        </PARTY></DELIVERY_PARTY></SHIPMENT_PARTIES>
      </ORDER_PARTIES>
      <PRICE_CURRENCY>EUR</PRICE_CURRENCY>
      <REMARK type="delivery">Anlieferung nur Mo-Fr 7-14 Uhr</REMARK>
    </ORDER_INFO>
  </ORDER_HEADER>
  <ORDER_ITEM_LIST>
    <ORDER_ITEM>
      <LINE_ITEM_ID>1</LINE_ITEM_ID>
      <ARTICLE_ID>
        <SUPPLIER_AID>20097108</SUPPLIER_AID>
        <BUYER_AID type="mercateo">A-77</BUYER_AID>
        <DESCRIPTION_SHORT>Packtisch mit Ablage 1970/970 x 2000 x 4</DESCRIPTION_SHORT>
      </ARTICLE_ID>
      <QUANTITY>1</QUANTITY><ORDER_UNIT>C62</ORDER_UNIT>
      <ARTICLE_PRICE type="net_customer"><PRICE_AMOUNT>412.50</PRICE_AMOUNT><PRICE_LINE_AMOUNT>412.50</PRICE_LINE_AMOUNT></ARTICLE_PRICE>
    </ORDER_ITEM>
    <ORDER_ITEM>
      <LINE_ITEM_ID>2</LINE_ITEM_ID>
      <ARTICLE_ID>
        <SUPPLIER_AID>20097106</SUPPLIER_AID>
        <EAN>4026212123456</EAN>
        <DESCRIPTION_SHORT><![CDATA[Packtisch 970 x 2000 x 800 vzk kpl. SPEE]]></DESCRIPTION_SHORT>
      </ARTICLE_ID>
      <QUANTITY>2</QUANTITY><ORDER_UNIT>C62</ORDER_UNIT>
      <ARTICLE_PRICE type="net_customer"><PRICE_AMOUNT>298,00</PRICE_AMOUNT><PRICE_LINE_AMOUNT>596,00</PRICE_LINE_AMOUNT></ARTICLE_PRICE>
    </ORDER_ITEM>
  </ORDER_ITEM_LIST>
  <ORDER_SUMMARY><TOTAL_ITEM_NUM>2</TOTAL_ITEM_NUM><TOTAL_AMOUNT>1008.50</TOTAL_AMOUNT></ORDER_SUMMARY>
</ORDER>`;

const OPENTRANS_21 = `<?xml version="1.0" encoding="UTF-8"?>
<ORDER xmlns="http://www.opentrans.org/XMLSchema/2.1" xmlns:bmecat="http://www.bmecat.org/bmecat/2005" version="2.1" type="standard">
  <ORDER_HEADER><ORDER_INFO>
    <ORDER_ID>PO-2026-118</ORDER_ID><ORDER_DATE>2026-10-09</ORDER_DATE>
    <PARTIES>
      <PARTY><bmecat:PARTY_ID type="supplier_specific">11247</bmecat:PARTY_ID><PARTY_ROLE>buyer</PARTY_ROLE>
        <ADDRESS><bmecat:NAME>Brill Gruppe GmbH</bmecat:NAME><bmecat:STREET>Hafenstr. 12</bmecat:STREET><bmecat:ZIP>48529</bmecat:ZIP><bmecat:CITY>Nordhorn</bmecat:CITY><bmecat:COUNTRY_CODED>DE</bmecat:COUNTRY_CODED>
          <CONTACT_DETAILS><bmecat:FIRST_NAME>Elke</bmecat:FIRST_NAME><bmecat:CONTACT_SURNAME>Romswinkel</bmecat:CONTACT_SURNAME><bmecat:EMAILS><bmecat:EMAIL>elke.romswinkel@brillgruppe.de</bmecat:EMAIL></bmecat:EMAILS></CONTACT_DETAILS>
        </ADDRESS></PARTY>
      <PARTY><bmecat:PARTY_ID type="buyer_specific">LAGER-2</bmecat:PARTY_ID><PARTY_ROLE>delivery</PARTY_ROLE>
        <ADDRESS><bmecat:NAME>Brill Lager Süd</bmecat:NAME><bmecat:STREET>Industriestr. 5</bmecat:STREET><bmecat:ZIP>48527</bmecat:ZIP><bmecat:CITY>Nordhorn</bmecat:CITY></ADDRESS></PARTY>
    </PARTIES>
    <ORDER_PARTIES_REFERENCE><bmecat:BUYER_IDREF type="supplier_specific">11247</bmecat:BUYER_IDREF>
      <SHIPMENT_PARTIES_REFERENCE><DELIVERY_IDREF type="buyer_specific">LAGER-2</DELIVERY_IDREF></SHIPMENT_PARTIES_REFERENCE></ORDER_PARTIES_REFERENCE>
    <bmecat:CURRENCY>EUR</bmecat:CURRENCY>
  </ORDER_INFO></ORDER_HEADER>
  <ORDER_ITEM_LIST>
    <ORDER_ITEM><LINE_ITEM_ID>10</LINE_ITEM_ID>
      <PRODUCT_ID><bmecat:SUPPLIER_PID>4026212260212</bmecat:SUPPLIER_PID><bmecat:BUYER_PID>B-9</bmecat:BUYER_PID><bmecat:DESCRIPTION_SHORT>Steckregal META CLIP 150 S</bmecat:DESCRIPTION_SHORT></PRODUCT_ID>
      <QUANTITY>19</QUANTITY><bmecat:ORDER_UNIT>C62</bmecat:ORDER_UNIT>
      <PRODUCT_PRICE_FIX><bmecat:PRICE_AMOUNT>1600.60</bmecat:PRICE_AMOUNT><bmecat:PRICE_QUANTITY>10</bmecat:PRICE_QUANTITY></PRODUCT_PRICE_FIX>
      <PRICE_LINE_AMOUNT>3041.14</PRICE_LINE_AMOUNT>
    </ORDER_ITEM>
  </ORDER_ITEM_LIST>
  <ORDER_SUMMARY><TOTAL_ITEM_NUM>1</TOTAL_ITEM_NUM><TOTAL_AMOUNT>3041.14</TOTAL_AMOUNT></ORDER_SUMMARY>
</ORDER>`;

const CXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE cXML SYSTEM "http://xml.cxml.org/schemas/cXML/1.2.014/cXML.dtd">
<cXML payloadID="1@x" timestamp="2026-10-10T10:00:00+02:00">
  <Header><From><Credential domain="NetworkID"><Identity>AN01</Identity></Credential></From></Header>
  <Request><OrderRequest>
    <OrderRequestHeader orderID="CX-4711" orderDate="2026-10-10T10:00:00+02:00" type="new">
      <Total><Money currency="EUR">250.00</Money></Total>
      <ShipTo><Address addressID="S1"><Name xml:lang="de">Delker GmbH</Name><PostalAddress><DeliverTo>Frank Delker</DeliverTo><Street>Am Hafen 3</Street><City>Bremen</City><PostalCode>28197</PostalCode><Country isoCountryCode="DE">Deutschland</Country></PostalAddress></Address></ShipTo>
      <BillTo><Address addressID="B1"><Name xml:lang="de">Delker Holding GmbH</Name><PostalAddress><Street>Domshof 1</Street><City>Bremen</City><PostalCode>28195</PostalCode><Country isoCountryCode="DE">Deutschland</Country></PostalAddress><Email>rechnung@delker.de</Email></Address></BillTo>
      <Contact role="buyer"><Name xml:lang="de">Frank Delker</Name><Email>einkauf@delker.de</Email></Contact>
      <Comments>Bitte avisieren</Comments>
    </OrderRequestHeader>
    <ItemOut quantity="2" lineNumber="1" requestedDeliveryDate="2026-10-30">
      <ItemID><SupplierPartID>4026212011104</SupplierPartID><BuyerPartID>DK-1</BuyerPartID></ItemID>
      <ItemDetail><UnitPrice><Money currency="EUR">125.00</Money></UnitPrice><Description xml:lang="de">META CLIP Grundregal 2500 x 1300 x 500<ShortName>Grundregal</ShortName></Description><UnitOfMeasure>EA</UnitOfMeasure></ItemDetail>
    </ItemOut>
  </OrderRequest></Request>
</cXML>`;

const latin1 = (s: string) => Buffer.from(s, "latin1");

describe("XML lesen", () => {
  it("Präfixe, CDATA, Entities, falsch geschlossene Tags", () => {
    const root = parseXml(`<?xml version="1.0"?><a:root x="1"><b>A &amp; B</b><c><![CDATA[<roh>]]></c><d>offen</root>`);
    assert.equal(root?.name, "root");
    assert.equal(root?.children[0].text, "A & B");
    assert.equal(root?.children[1].text, "<roh>");
  });
});

describe("openTRANS 1.0 (Mercateo)", () => {
  it("Positionen, Preise, Rechnungs- und Lieferadresse, Kundennummer", () => {
    const parsed = parseOrderXml(latin1(OPENTRANS_1));
    assert.ok(parsed);
    const e = parsed.extraction;
    assert.equal(parsed.format, "opentrans");
    assert.equal(e.document.type, "purchase_order");
    assert.equal(e.document.number, "4525628622");
    assert.equal(e.document.date, "2026-10-10");
    assert.equal(e.document.delivery_date, "2026-10-24");
    assert.equal(e.document.total_net, 1008.5);
    // ISO-8859-1 richtig dekodiert, kein „KÃ¶then“
    assert.equal(e.buyer.city, "Köthen");
    assert.equal(e.buyer.company, "Unite Procurement Deutschland AG");
    assert.equal(e.buyer.customer_number, "20000042592");
    assert.equal(e.buyer.email, "operations@mercateo.com");
    assert.equal(e.buyer.contact_person, "Heike Eichler");
    assert.equal(e.delivery_address.same_as_buyer, false);
    assert.equal(e.delivery_address.company, "Schäfer Logistik GmbH");
    assert.equal(e.delivery_address.street, "Rudolphstraße 1");
    assert.equal(e.delivery_address.zip, "34821");
    assert.equal(e.references?.delivery_contact_name, "Jan Schäfer");
    assert.equal(e.references?.invoice_email, "invoice@mercateo.com");
    assert.match(e.terms.notes ?? "", /Wareneingang Tor 3/);
    assert.match(e.terms.notes ?? "", /Anlieferung nur/);
    assert.deepEqual(
      e.line_items.map((l) => [l.position, l.quantity, l.supplier_sku, l.buyer_sku, l.unit_price_net, l.alternative_skus]),
      [
        [1, 1, "20097108", "A-77", 412.5, []],
        [2, 2, "4026212123456", null, 298, ["20097106"]],
      ],
    );
    assert.equal(e.line_items[1].description, "Packtisch 970 x 2000 x 800 vzk kpl. SPEE");
  });

  it("Legacy-Form für den Entwurf: keine Adresszeilen als Positionen", () => {
    const legacy = extractLegacyFromOrderXml(latin1(OPENTRANS_1));
    assert.ok(legacy);
    assert.equal(legacy.orderXmlFormat, "opentrans");
    assert.equal(legacy.lineItems?.length, 2);
    assert.ok(legacy.lineItems?.every((l) => !/Köthen|Gudensberg/.test(l.extractedProductName)));
    assert.equal(legacy.billingAddress?.company, "Unite Procurement Deutschland AG");
    assert.equal(legacy.shippingAddress?.city, "Gudensberg");
    assert.equal(legacy.documentExtraction?.extraction_meta.total_matches_calculated, true);
  });
});

describe("Kodierung und Bemerkungen", () => {
  it("Deklaration ISO-8859-1, Inhalt UTF-8 (Mercateo)", () => {
    const e = parseOrderXml(Buffer.from(OPENTRANS_1, "utf-8"))!.extraction;
    assert.equal(e.delivery_address.street, "Rudolphstraße 1");
    assert.equal(e.buyer.city, "Köthen");
  });

  it("Bemerkungstyp order ohne Präfix, delivery deutsch", () => {
    const xml = OPENTRANS_1.replace('<REMARK type="delivery">', '<REMARK type="order">Link zur Bestellung</REMARK><REMARK type="delivery">');
    const notes = parseOrderXml(latin1(xml))!.extraction.terms.notes ?? "";
    assert.match(notes, /^Link zur Bestellung$/m);
    assert.match(notes, /^Lieferung: Anlieferung nur/m);
  });
});

describe("openTRANS 2.1", () => {
  it("Parteien über PARTY_ROLE/IDREF, Preis je Preiseinheit", () => {
    const e = parseOrderXml(Buffer.from(OPENTRANS_21))!.extraction;
    assert.equal(e.document.number, "PO-2026-118");
    assert.equal(e.buyer.company, "Brill Gruppe GmbH");
    assert.equal(e.buyer.customer_number, "11247");
    assert.equal(e.buyer.contact_person, "Elke Romswinkel");
    assert.equal(e.buyer.email, "elke.romswinkel@brillgruppe.de");
    assert.equal(e.delivery_address.company, "Brill Lager Süd");
    assert.equal(e.line_items[0].position, 10);
    assert.equal(e.line_items[0].quantity, 19);
    assert.equal(e.line_items[0].unit_price_net, 160.06);
    assert.equal(e.line_items[0].supplier_sku, "4026212260212");
    assert.equal(e.document.currency, "EUR");
  });
});

describe("cXML OrderRequest", () => {
  it("BillTo als Rechnung, ShipTo als Lieferadresse, Einkäufer als Kontakt", () => {
    const e = parseOrderXml(Buffer.from(CXML))!.extraction;
    assert.equal(e.document.number, "CX-4711");
    assert.equal(e.document.total_net, 250);
    assert.equal(e.buyer.company, "Delker Holding GmbH");
    assert.equal(e.buyer.email, "einkauf@delker.de");
    assert.equal(e.buyer.country, "DE");
    assert.equal(e.delivery_address.company, "Delker GmbH");
    assert.equal(e.references?.delivery_contact_name, "Frank Delker");
    assert.deepEqual(e.line_items.map((l) => [l.quantity, l.supplier_sku, l.buyer_sku, l.unit_price_net, l.description]), [
      [2, "4026212011104", "DK-1", 125, "META CLIP Grundregal 2500 x 1300 x 500"],
    ]);
    assert.equal(e.terms.notes, "Bitte avisieren");
  });
});

describe("Unbekanntes XML", () => {
  it("Rechnung/Katalog nicht relevant, fremde Bestellung als Text für die KI", () => {
    assert.equal(isOrderRelevantXml(Buffer.from(`<?xml version="1.0"?><Invoice><ID>1</ID></Invoice>`)), false);
    assert.equal(isOrderRelevantXml(Buffer.from(`<?xml version="1.0"?><ORDERRESPONSE><X/></ORDERRESPONSE>`)), false);
    const foreign = Buffer.from(`<?xml version="1.0"?><Bestellung><Kopf><Nummer>77</Nummer></Kopf><Pos menge="3"><Artikel>4026212011104</Artikel></Pos></Bestellung>`);
    assert.equal(isOrderRelevantXml(foreign), true);
    assert.equal(parseOrderXml(foreign), null);
    const text = xmlToPlainText(foreign);
    assert.match(text, /Kopf\/Nummer: 77/);
    assert.match(text, /Pos\/Artikel: 4026212011104/);
    assert.match(text, /Pos \[menge=3\]/);
  });
});

describe("Mail mit XML-Anhang", () => {
  const eml = (xml: Buffer) =>
    Buffer.from(
      [
        "From: Mercateo <operations@mercateo.com>",
        "To: shop@meta-online.com",
        "Subject: Bestellung 4525628622",
        "MIME-Version: 1.0",
        'Content-Type: multipart/mixed; boundary="b1"',
        "",
        "--b1",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Sehr geehrte Damen und Herren, anbei unsere Bestellung.",
        "Mercateo Deutschland AG, Museumsgasse 4-5",
        "06354 Köthen",
        "--b1",
        'Content-Type: application/octet-stream; name="Bestellung_4525628622.xml"',
        'Content-Disposition: attachment; filename="Bestellung_4525628622.xml"',
        "Content-Transfer-Encoding: base64",
        "",
        xml.toString("base64"),
        "--b1--",
        "",
      ].join("\r\n"),
    );

  it("XML-Anhang bleibt erhalten und wird als Bestellung gelesen", async () => {
    const parsed = await parseEmlFile(eml(latin1(OPENTRANS_1)));
    const xml = parsed.attachments.find((a) => a.filename.endsWith(".xml"));
    assert.ok(xml);
    assert.equal(xml.contentType, "application/xml");
    const text = await extractPlainTextForDraft({ fileBuffer: xml.content, mimeType: xml.contentType, fileName: xml.filename, ocrEnabled: false });
    assert.match(text, /Bestellung 4525628622 \(openTRANS\)/);
    assert.match(text, /2\. 2 C62 4026212123456 \/ 20097106 Packtisch/);
  });

  it("Rechnungs-XML wird verworfen", async () => {
    const parsed = await parseEmlFile(eml(Buffer.from(`<?xml version="1.0"?><Invoice><ID>1</ID></Invoice>`)));
    assert.equal(parsed.attachments.length, 0);
  });
});

describe("Anhänge aufteilen", () => {
  it("XML ist die Bestellung, die PDF-Kopie wird Beilage", async () => {
    const xml = { filename: "Bestellung.xml", contentType: "application/xml", buffer: latin1(OPENTRANS_1) };
    const pdf = { filename: "Bestellung_4525628622.pdf", contentType: "application/pdf", buffer: Buffer.from("%PDF-1.4 kaputt") };
    const result = await partitionCommercialParts([pdf, xml]);
    assert.deepEqual(result.draftParts, [xml]);
    assert.equal(result.supportingParts.length, 1);
    assert.equal(result.supportingParts[0].part, pdf);
    assert.equal(result.supportingParts[0].classification.kind, "purchase_order");
    assert.ok(result.supportingParts[0].classification.signals.includes("order_xml_preferred"));
  });

  it("Klassifikation der XML", () => {
    const c = classifyXmlAttachment(latin1(OPENTRANS_1));
    assert.equal(c.kind, "purchase_order");
    assert.equal(c.references.orderNumber, "4525628622");
    assert.equal(classifyXmlAttachment(Buffer.from(`<?xml version="1.0"?><Invoice/>`)).kind, "other");
  });

  it("Lesbarer Text enthält Lieferadresse", () => {
    const text = orderXmlToReadableText(parseOrderXml(latin1(OPENTRANS_1))!);
    assert.match(text, /Lieferadresse: Schäfer Logistik GmbH, Rudolphstraße 1, 34821 Gudensberg, DE/);
    assert.match(text, /Kundennummer: 20000042592/);
  });
});
