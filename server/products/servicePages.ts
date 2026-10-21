// Service-Seiten im Shop (User 21.10.2026: „Interessenten sollen im Shop bleiben“): Montageanleitungen und
// Montagevideos sowie die Anfrage zum Montageservice. Die System-Landingpages (categoryLandingPages.ts) verlinken
// hierher statt auf meta-online.com. Geschrieben von scripts/writeServicePages.ts.
//
// Anleitungen und Videos liegen im OXOMI-Portal von META (Portal 1129890, Marke META-Regalbau, Sprache Deutsch;
// dieselbe Quelle wie meta-online.com/de-DE/service/kataloge-und-montageanleitungen). Stand 21.10.2026, abgefragt über
// https://oxomi.com/portals/api/v1/universal-search/search (contentType instruction bzw. training) und
// …/video/details (720p, H.264). PDFs über die öffentliche Download-Adresse je Dokument – die liefert immer die
// aktuelle Fassung. Neue Anleitungen/Videos: Liste hier ergänzen.
// Inhalte Montageservice nur nach Katalog S. 11 und meta-online.com/de-DE/service/montage (Regel: nur belegte META-Inhalte).
import type { IndustryNote } from "@shared/shopContent";

export const OXOMI_PORTAL = "1129890";
export const oxomiDocumentUrl = (id: string) => `https://oxomi.com/portals/api/v1/documents/download?portal=${OXOMI_PORTAL}&document=${id}`;

export type ServiceGroupKey = "sicherheit" | "fachboden" | "weitspann" | "paletten" | "kragarm" | "weitere";
export type ServiceDocument = { id: string; group: ServiceGroupKey; title: string };
export type ServiceVideo = { id: string; group: ServiceGroupKey; title: string; duration: string; mp4: string };

/** Gruppen der Anleitungsseite; Anker = Sprungziel der Landingpages (#fachbodenregale usw.) */
export const SERVICE_GROUPS: Array<{ key: ServiceGroupKey; anchor: string; title: string; landing?: string }> = [
  { key: "sicherheit", anchor: "sicherheit", title: "Sicherheitshinweise" },
  { key: "fachboden", anchor: "fachbodenregale", title: "Fachbodenregale META CLIP und META FIX", landing: "/fachbodenregale/" },
  { key: "weitspann", anchor: "weitspannregale", title: "Weitspannregale META SPEED-RACK und MINI-RACK", landing: "/weitspannregale/" },
  { key: "paletten", anchor: "palettenregale", title: "Palettenregale META MULTIPAL", landing: "/palettenregale/" },
  { key: "kragarm", anchor: "kragarmregale", title: "Kragarmregale META ATLAS ST und MULTISTRONG", landing: "/kragarmregale/" },
  { key: "weitere", anchor: "weitere", title: "Weitere Anleitungen" },
];

export const SERVICE_DOCUMENTS: ServiceDocument[] = [
  { id: "10575109", group: "sicherheit", title: "META Sicherheitshinweise / Safety Instructions" },
  { id: "10454970", group: "fachboden", title: "META CLIP Steckregalsystem Systemkomponenten" },
  { id: "10454976", group: "fachboden", title: "META CLIP Steckregalsystem Zubehör" },
  { id: "10528733", group: "fachboden", title: "META CLIP Felgenregal" },
  { id: "10094615", group: "fachboden", title: "META CLIP Gitterkorbregal leicht" },
  { id: "10446118", group: "fachboden", title: "META CLIP Gitterkorbregal schwer" },
  { id: "10623349", group: "fachboden", title: "META CLIP Regalwagen" },
  { id: "10092185", group: "fachboden", title: "META CLIP Reifenregal" },
  { id: "10094485", group: "fachboden", title: "META CLIP S3" },
  { id: "10528752", group: "fachboden", title: "META CLIP SET Warenträger" },
  { id: "10528746", group: "fachboden", title: "META CLIP SPLIT" },
  { id: "10094486", group: "fachboden", title: "META CLIP Warenträger Typ 1" },
  { id: "10711180", group: "weitere", title: "META MULTIFLOOR" },
  { id: "10696678", group: "weitere", title: "META Schilderregal" },
  { id: "10413890", group: "fachboden", title: "META FIX Schraubregal" },
  { id: "10387090", group: "weitspann", title: "META SPEED-RACK Weitspannregalsystem" },
  { id: "10387089", group: "weitspann", title: "META MINI-RACK Weitspannregalsystem" },
  { id: "10467283", group: "paletten", title: "META MULTIPAL Palettenregalsystem Systemkomponenten" },
  { id: "10454985", group: "paletten", title: "META MULTIPAL Palettenregalsystem Zubehör" },
  { id: "10626069", group: "paletten", title: "META MULTIPAL Kabeltrommelregal" },
  { id: "10181331", group: "paletten", title: "META MULTIPAL Profillagerregal" },
  { id: "10668936", group: "kragarm", title: "META Kragarmregale ATLAS ST und MULTISTRONG L + M" },
  { id: "10413891", group: "kragarm", title: "META MULTISTRONG H Kragarmregalsystem" },
];

export const SERVICE_VIDEOS: ServiceVideo[] = [
  { id: "15568", group: "fachboden", title: "META CLIP", duration: "01:55", mp4: "https://video.oxomi.com/dasd/xxl/p/media/RpfVMkYEzImmgNowAV8Hilk2ijlayOVpzQ79Muc3djg/H3A1BRSIMPU1D4PCP1IK6K5DBS/EA1CQIOI4J26NAKBLHUD0HHD7K.mp4" },
  { id: "16441", group: "fachboden", title: "META CLIP Drahtgitterfachbodenregal", duration: "01:33", mp4: "https://video.oxomi.com/dasd/xxl/p/media/yEz2wqcB6BQJCcx4SRnjFYuDYtyPHiNNwSjryoH5AsQ/6CD7N5UUU0G5OMA1IBB8TANTFS/BAATKC4IFS7U8DD7B1GA1QJCIC.mp4" },
  { id: "16443", group: "fachboden", title: "META CLIP Fachteiler durchgehend", duration: "00:49", mp4: "https://video.oxomi.com/dasd/xxl/p/media/OKowDWT99F4_4Ia8PHGm8x9rjVQQ6aq8wCSJ-lwxEwM/D0I3VS7N4KLFCCJQ3GR6U8VF4C/RUJ6E4ET065PU9JF8LODPNCBIC.mp4" },
  { id: "16442", group: "fachboden", title: "META CLIP Fachteiler freistehend", duration: "00:44", mp4: "https://video.oxomi.com/dasd/xxl/p/media/leUP2H2rXyFIOLqasN6fpBM5ktpg6qAMuOvKKkGJ_ZY/N631SPMN9HAVT430T20U6R4KGO/C6EGI127KLVDNO145777ET80F8.mp4" },
  { id: "16444", group: "fachboden", title: "META CLIP S3 Längsriegel", duration: "01:28", mp4: "https://video.oxomi.com/dasd/xxl/p/media/ox6FzGiZOBZMVGXvCpt1wporWbYt4K-Bvdv9sD5SU7Q/FTLNHL9HEE9VS9O0PEGMG5N60S/PNTIRDD37LPOL6CCRVP5O56SKS.mp4" },
  { id: "16445", group: "fachboden", title: "META CLIP Schüttgutmulde", duration: "00:47", mp4: "https://video.oxomi.com/dasd/xxl/p/media/NwuDPQyRHHofIGV3FQaaKDC90uF9ZJzlPPYf5zIYSsA/5JNPNR57A80HS6TIHFSJF7P4AG/UQHBCJTKSAI4DD4C9V07R3I3V0.mp4" },
  { id: "16447", group: "paletten", title: "META MULTIPAL Anbauregal", duration: "01:53", mp4: "https://video.oxomi.com/dasd/xxl/p/media/kjKLjjUDPYmDSM9t-Shv4ZdTrPXLO4FfSQpq6XopzIE/13JJEO6MER78UMP16GB53D68AK/S9L3E8EP3AAQIGC5P2L00JJ6RC.mp4" },
  { id: "16448", group: "paletten", title: "META MULTIPAL Drahtgitterböden", duration: "00:29", mp4: "https://video.oxomi.com/dasd/xxl/p/media/q_7YTYwBrZZ7FycvmBA3ghDOwEzwKbXUalCvxUcIogg/K2NGVMEVT4LF5KFB1JQTIJGFJ8/AKJPJ0BS4A3MPASO3M7RGUNV5O.mp4" },
  { id: "16449", group: "paletten", title: "META MULTIPAL Durchschubsicherung", duration: "00:48", mp4: "https://video.oxomi.com/dasd/xxl/p/media/UZHPbV975vrdKgEqflvdor0DnZgI15yaJBC2q_EzC_w/7GE4TFCRONRBBTATLMF2HVV1U8/09PPE96J7038T8NF7DC41781F8.mp4" },
  { id: "16446", group: "paletten", title: "META MULTIPAL Grundregal", duration: "02:08", mp4: "https://video.oxomi.com/dasd/xxl/p/media/r40ZBjwG8nCo-tcyUvzmd0UL0b8JPXZj6BqbBqdWU7M/7QMONAV33KGABBJ3M1PA4UQNCK/71PNA8O5QB1KQVH8SQADRJCRRS.mp4" },
  { id: "16450", group: "paletten", title: "META MULTIPAL Rückwandgitter", duration: "00:51", mp4: "https://video.oxomi.com/dasd/xxl/p/media/4YfPINwqYVvEd5YtLFlb2p4s2I45JmmMsC4d6vav_h0/ELTQPCP4LKS584D44M4HJA6MTO/AF2CLL3JICS8S0GT7NDAP062IS.mp4" },
  { id: "16451", group: "paletten", title: "META MULTIPAL Tiefenauflage", duration: "00:37", mp4: "https://video.oxomi.com/dasd/xxl/p/media/cr4AnK_0hKf5qV45vBUkppW_Ek38X59PtOmrLpx-8kc/IEIHI4M902BEPGTIC0JBIIVSOS/PK3TAOM14VNVO58EKOLMKM1RR0.mp4" },
  { id: "16452", group: "paletten", title: "META MULTIPAL Winkelauflage", duration: "01:00", mp4: "https://video.oxomi.com/dasd/xxl/p/media/TY8By1h7Q8zNRA11gAWx1c_L5lqda0wyZgalVfn_fsA/148K1M513MKTSJ15F2OSKOCPIK/INR00GO0EN3QGNIU2HUL92O3M4.mp4" },
  { id: "16453", group: "paletten", title: "META MULTIPAL Zentrierblech", duration: "00:29", mp4: "https://video.oxomi.com/dasd/xxl/p/media/4SCDcdsFiDz6A0pnSo6e3QiK2MUSLqgXxXmn8HhIXvg/T8F06UHATGCJFAV4F6VKACGEGC/PQQ11OD0K6DR00AI6CJJ0TPQB8.mp4" },
  { id: "16463", group: "kragarm", title: "META MULTISTRONG MEDIUM Anbauregal", duration: "02:53", mp4: "https://video.oxomi.com/dasd/xxl/p/media/fzGR6vF6nNPitnEsoXEFcxkyglIS8MOUoOhK4hux5Qw/2TCATD3QJ40O0L6SK8LDHC7858/3M331HCM5QD7OJ1EVQIGRFE9AS.mp4" },
  { id: "16462", group: "kragarm", title: "META MULTISTRONG MEDIUM Grundregal", duration: "02:28", mp4: "https://video.oxomi.com/dasd/xxl/p/media/LowjIQG_qCy_IhDFkUIqXehrCs0DmWH17eh2aIEvNJY/3CJ1BOIEKDSG4H28UJL49I3460/LBVHNRJB8PC1AUJ883ND0B4FFG.mp4" },
];

export type ServicePage = {
  key: "anleitungen" | "montageservice";
  url: string;
  name: string;
  /** Name im Menü unter „Service“ */
  menuName: string;
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  h1: string;
  lead: string;
  notes: Partial<Record<"hero" | "list" | "videos" | "form" | "menu", IndustryNote>>;
};

export const SERVICE_PAGES: ServicePage[] = [
  {
    key: "anleitungen",
    url: "service/montageanleitungen",
    name: "Montageanleitungen und Videos",
    menuName: "Montageanleitungen und Videos",
    metaTitle: "Montageanleitungen und Montagevideos für META Regale | META",
    metaDescription:
      "Montageanleitungen als PDF und Montagevideos für META CLIP, MULTIPAL, MINI-RACK, SPEED-RACK, ATLAS ST und MULTISTRONG – direkt vom Hersteller.",
    eyebrow: "Service",
    h1: "Montageanleitungen und Montagevideos",
    lead:
      "Hier finden Sie die Montageanleitungen der META-Regalsysteme als PDF und kurze Montagevideos. Lesen Sie vor dem Aufbau die Sicherheitshinweise – sie liegen jeder Lieferung bei. Wenn Sie nicht selbst aufbauen möchten, übernimmt das der META-Montageservice.",
    notes: {
      hero: { text: "Neue Seite unter Service. Quelle der Dateien: OXOMI-Portal von META, dieselben Dokumente wie auf meta-online.com.", src: "meta-online.com/de-DE/service/kataloge-und-montageanleitungen" },
      list: {
        text: "PDF-Links gehen auf die öffentliche Download-Adresse bei OXOMI (immer aktuelle Fassung, öffnet in neuem Tab). Keine Vorschaubilder von OXOMI, damit beim Seitenaufruf nichts von fremden Servern geladen wird.",
        checks: ["„META Schilderregal“ und „META MULTIFLOOR“ stehen unter „Weitere Anleitungen“ – richtig zugeordnet?"],
        src: "OXOMI-Portal 1129890, Stand 21.10.2026",
      },
      videos: {
        text: "Videos werden erst beim Klick auf „Video abspielen“ von video.oxomi.com geladen (2-Klick-Lösung mit Hinweis). Englische Titelteile („/Wire mesh shelving“) weggelassen.",
        checks: ["Datenschutz: OXOMI (scireum GmbH) als Videodienst in der Datenschutzerklärung genannt?"],
        src: "OXOMI-Portal 1129890, 720p H.264",
      },
      menu: { text: "Menüpunkt unter „Service“ (Hauptnavigation gilt für DE, AT und PL; die Seite hängt an DE und AT).", src: "Shop-Navigation Live" },
    },
  },
  {
    key: "montageservice",
    url: "service/montageservice",
    name: "Montageservice",
    menuName: "Montageservice anfragen",
    metaTitle: "Montageservice für META Regale anfragen | META",
    metaDescription: "META baut Ihre Regale auf: geschulte Montageteams installieren Ihre Lagereinrichtung – von kleineren Regalzeilen bis zu Großprojekten. Jetzt anfragen.",
    eyebrow: "Service",
    h1: "Montageservice: Wir bauen Ihre Regale auf",
    lead:
      "Sie möchten Ihr Regal fix und fertig montiert? Auf Wunsch übernehmen unsere geschulten Montageteams den Aufbau – von kleineren Regalzeilen bis hin zu Großprojekten. Schicken Sie uns Ihre Anfrage, wir stimmen Umfang und Termin mit Ihnen ab.",
    notes: {
      hero: { text: "Texte nach meta-online.com/de-DE/service/montage und Katalog S. 11; keine Preise oder Fristen, die nicht belegt sind.", src: "Katalog S. 11; meta-online.com Montage" },
      form: {
        text: "Shopware-Kontaktformular (Standard-Empfänger der Shop-Einstellungen, live shop@meta-online.com). Ein kleines Script setzt den Betreff „Anfrage Montageservice“ und gibt in der Nachricht eine Vorlage für die wichtigsten Angaben vor.",
        checks: ["Sollen Montageanfragen an shop@meta-online.com gehen oder an eine andere Adresse (z. B. Montageabteilung)?"],
        src: "Shop-Einstellungen core.basicInformation.email",
      },
      menu: { text: "Menüpunkt unter „Service“.", src: "Shop-Navigation Live" },
    },
  },
];

/** Montageservice: Leistung (meta-online.com Montage, Katalog S. 11) */
export const MONTAGE_POINTS = [
  { title: "Alles aus einer Hand", text: "Von der Konzeption und Fertigung bis zur Realisierung: Auf Wunsch übernimmt META auch den Aufbau Ihrer Regale." },
  { title: "Geschulte Montageteams", text: "Unsere Montageteams installieren Ihre Lagereinrichtung schnell und fachgerecht – von kleineren Regalzeilen bis hin zu Großprojekten." },
  { title: "Termin abgestimmt", text: "Im Rahmen der Projektplanung stimmen wir alle Punkte mit Ihnen ab, damit die Montage fach- und zeitgerecht erfolgt." },
];

/** Was in die Anfrage gehört (Vorlage im Nachrichtenfeld) */
export const MONTAGE_REQUEST_FIELDS = [
  "Aufstellort (PLZ und Ort)",
  "Regalsystem und Umfang (z. B. META CLIP, 3 Regalzeilen à 5 Felder)",
  "Bestell- oder Angebotsnummer, falls vorhanden",
  "Wunschtermin",
  "Besonderheiten vor Ort (Etage, Zufahrt, Bodenbeschaffenheit)",
];
export const MONTAGE_SUBJECT = "Anfrage Montageservice";
