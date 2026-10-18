/*
 * METAorder: Regal-Schnellkonfigurator für Fachboden-, Paletten-, Weitspann-, Kragarm-, Großfach- und Büroregale.
 *
 * Quelle: shopware/storefront-snippets/quick-configurator.js im METAorder-Repo.
 * Eingespielt über das Plugin „Eigenes CSS/JS" (DneCustomCssJs) per
 * scripts/writeQuickConfigurator.ts. Änderungen im Shop-Admin überschreibt der nächste Lauf.
 *
 * Vier Stellen im Shop:
 * - Seite /regal-schnellkonfigurator (Erlebniswelt aus scripts/writeQuickConfiguratorPage.ts):
 *   Regalart, Maße, Last und maximale Regallänge (verfügbarer Platz) eingeben. Das Skript stellt die Regalzeile aus
 *   1 Grundregal und n Anbauregalen zusammen (so lang wie möglich, nie länger als angegeben), zeigt bei
 *   Bedarf eine Zeile mit gemischten Feldbreiten, holt die Preise in der Sitzung des Kunden von den
 *   Produktseiten (Händler- und Kundenpreise stimmen) und legt alles mit einem Klick in den Warenkorb.
 * - Startseite: kleines Formular (Abschnitt aus writeQuickConfiguratorPage.ts --home), das zur Seite führt.
 * - Einstiegskasten auf den Seiten und Listen der Regalarten.
 * - Produktseite eines Grund- oder Anbauregals: Link zum Konfigurator mit den Maßen des Artikels.
 *
 * Die Artikeltabelle (Datei in den Shop-Medien) steht im Attribut data-catalog der Seite und wird
 * nur dort geladen. Fehler bleiben still: ohne Tabelle erscheint ein Hinweis statt des Formulars.
 */
var MetaQuickConfigurator = (function () {
  'use strict';

  var CONFIG = {
    version: '2',
    // Nur der Onlineshop „META Regalbau DE" (gleiche ID im Testshop und im Live-Shop).
    salesChannelIds: ['018ec134507f703b82a76467791e7e61'],
    pagePath: '/regal-schnellkonfigurator',
    // Gemischte Feldbreiten nur zeigen, wenn die Zeile damit spürbar länger wird.
    minMixGainMm: 100,
    maxFields: 60,
    maxLines: 4,
    timeoutMs: 10000
  };

  /*
   * Gesamtlänge einer Zeile = start + Summe(Feldbreite + per).
   * - CLIP/COMPACT: 40 mm je Ständerrahmen (wie im Regalplaner) → start 40, per 40
   * - MINI-RACK laut Katalog S. 114: Grundregal = Nennlänge + 107 mm, Anbauregal = Nennlänge + 51 mm
   * - MULTISTRONG: Achsmaß = Feldbreite + 30 mm (Katalog: 1.030/1.330 mm) plus Ständerbreite
   *   (IPE 120: 64 mm bei LIGHT, IPE 140: 73 mm bei MEDIUM)
   * - MULTIPAL: Stützenbreite je Artikel aus dem Shop (Stützentyp „85/20" → 85 mm), steht in der Tabelle
   */
  var RULES = {
    'META CLIP': { start: 40, per: 40 },
    'META CLIP S3': { start: 40, per: 40 },
    'META CLIP COMPACT': { start: 40, per: 40 },
    'META CLIP COMPACT S3': { start: 40, per: 40 },
    'META MINI-RACK': { start: 56, per: 51 },
    'META MULTISTRONG L': { start: 64, per: 30 },
    'META MULTISTRONG M': { start: 73, per: 30 }
  };

  var KINDS = {
    fachboden: {
      label: 'Fachbodenregal', type: 'Fachbodenregal', systems: ['META CLIP', 'META CLIP S3'],
      sides: ['Einzelregal', 'Doppelregal'], width: 'Feldbreite', depth: 'Tiefe', load: 'Fachlast',
      defaults: { h: 2000, b: 1000, t: 500, load: 150 }, tipping: true,
      paths: ['/fachbodenregale', '/clip-grundregale', '/clip-anbauregale', '/clip-komplettregale'],
      lengthNote: 'Gesamtlänge gerechnet mit 40 mm je Ständerrahmen.'
    },
    palette: {
      label: 'Palettenregal', type: 'Palettenregal', systems: ['META MULTIPAL'],
      width: 'Holmlänge', depth: 'Tiefe', load: 'Fachlast', pallet: true,
      defaults: { h: 3300, b: 2700, t: 1100, weight: 800 }, minFields: 4,
      paths: ['/palettenregale', '/multipal-grundregale', '/multipal-anbauregale'],
      lengthNote: 'Gesamtlänge gerechnet mit der Stützenbreite des Ständerrahmens (Stützentyp).'
    },
    weitspann: {
      label: 'Weitspannregal', type: 'Weitspannregal', systems: ['META MINI-RACK'],
      width: 'Fachlänge', depth: 'Tiefe', load: 'Fachlast',
      defaults: { h: 2500, b: 1800, t: 800, load: 490 }, tipping: true, minFields: 4,
      paths: ['/weitspannregale', '/mini-rack-grundregale', '/mini-rack-anbauregale'],
      lengthNote: 'Gesamtlänge nach Planmaß laut META-Katalog: Grundregal = Fachlänge + 107 mm, Anbauregal = Fachlänge + 51 mm.'
    },
    kragarm: {
      label: 'Kragarmregal', type: 'Kragarmregal', systems: ['META MULTISTRONG L', 'META MULTISTRONG M'],
      sides: ['einseitig', 'doppelseitig'], width: 'Feldbreite', depth: 'Armlänge', load: 'Armlast',
      defaults: { h: 2500, b: 1000, t: 500, load: 175 },
      paths: ['/kragarmregale', '/multistrong-grundregale', '/multistrong-anbauregale'],
      lengthNote: 'Gesamtlänge aus dem Achsmaß (Feldbreite + 30 mm) plus Ständerbreite (IPE 120: 64 mm, IPE 140: 73 mm).'
    },
    grossfach: {
      label: 'Großfachregal', type: 'Großfachregal', systems: ['META MULTIPAL'],
      width: 'Fachlänge', depth: 'Tiefe', load: 'Fachlast',
      defaults: { h: 2700, b: 1825, t: 800, load: 1000 }, minFields: 4,
      paths: [],
      lengthNote: 'Gesamtlänge gerechnet mit der Stützenbreite des Ständerrahmens (Profil).'
    },
    buero: {
      label: 'Büroregal', type: 'Büro-Steckregal', systems: ['META CLIP COMPACT', 'META CLIP COMPACT S3'],
      width: 'Fachbreite', depth: 'Tiefe', load: 'Fachlast',
      defaults: { h: 2200, b: 1000, t: 300, load: 80 },
      paths: ['/bueroregale', '/compact-grundregale', '/compact-anbauregale'],
      lengthNote: 'Gesamtlänge gerechnet mit 40 mm je Ständerrahmen.'
    }
  };
  var KIND_ORDER = ['fachboden', 'palette', 'weitspann', 'kragarm', 'grossfach', 'buero'];

  var TEXT = {
    surface: { 'verzinkt': 'Verzinkt', 'RAL 7035': 'RAL 7035 lichtgrau', 'RAL 9005': 'RAL 9005 tiefschwarz', 'RAL 5010': 'RAL 5010 enzianblau' },
    frame: {
      'META CLIP': 'Rahmen vorgefertigt (geclincht), fertig montiert geliefert',
      'META CLIP S3': 'Zerlegter S3-Rahmen, ohne Werkzeug zusammengesteckt',
      'META MULTISTRONG L': 'MULTISTRONG LIGHT, Ständer IPE 120',
      'META MULTISTRONG M': 'MULTISTRONG MEDIUM, Ständer IPE 140'
    },
    // Laut META-Katalog (S. 23, 29)
    bracing: {
      diagonal: 'Mit Diagonalverstrebung, einseitig bedienbar, ideal an Wänden',
      lr: 'Mit Längsriegeln, von beiden Seiten bedienbar',
      doubleDiagonal: 'Doppelregal mit Diagonalverstrebung: zwei Zeilen Rücken an Rücken, Zugriff von beiden Seiten',
      doubleLr: 'Doppelregal mit Längsriegeln: Zugriff von beiden Seiten, Lagergut kann durchgelagert werden'
    }
  };

  function toNumber(raw) {
    var s = String(raw == null ? '' : raw).trim().replace(/\s+/g, '');
    if (!s) return NaN;
    return Number(s.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  }

  // Verfügbare Länge: „4200", „4.200", „4200 mm", „4,2 m" oder „4,2" (kleine Zahlen sind Meter).
  function parseLength(raw) {
    var s = String(raw == null ? '' : raw).toLowerCase().trim();
    if (!s) return null;
    var meters = /\d\s*m$/.test(s) && !/mm$/.test(s);
    var n = toNumber(s.replace(/m+$/, ''));
    if (!isFinite(n) || n <= 0) return null;
    if (meters || n < 100) n = n * 1000;
    return Math.round(n);
  }

  function parseWeight(raw) {
    var n = toNumber(String(raw == null ? '' : raw).toLowerCase().replace(/kg$/, ''));
    return isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  function formatNumber(n) {
    return new Intl.NumberFormat('de-DE').format(Math.round(n));
  }

  function formatMm(mm) {
    return formatNumber(mm) + ' mm';
  }

  function formatPrice(value) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
  }

  function surfaceLabel(surface) {
    return TEXT.surface[surface] || surface;
  }

  function decodeCatalog(raw) {
    if (!raw || !Array.isArray(raw.items)) return [];
    if (raw.v === 1) {
      // Erste Fassung: nur CLIP/CLIP S3 Fachbodenregale
      return raw.items.map(function (r) {
        var role = raw.roles[r[2]] || '';
        return {
          id: r[0], kind: 'fachboden', system: raw.systems[r[1]], role: role, double: role.indexOf('Doppel-') === 0,
          base: /Grundregal$/.test(role), h: r[3], b: r[4], t: r[5], load: r[6], levels: raw.levels[r[7]], pallets: 0,
          surface: raw.surfaces[r[9]], board: null, feature: r[8] === 1 ? 'Längsriegel' : null, post: 0
        };
      });
    }
    if (raw.v !== 2) return [];
    return raw.items.map(function (r) {
      var role = raw.roles[r[3]] || '';
      return {
        id: r[0],
        kind: raw.kinds[r[1]],
        system: raw.systems[r[2]],
        role: role,
        double: r[11] === 1,
        base: /Grundregal$/.test(role),
        h: r[4],
        b: r[5],
        t: r[6],
        load: r[7],
        levels: raw.levels[r[8]],
        pallets: r[9],
        surface: r[10] >= 0 ? raw.surfaces[r[10]] : null,
        board: r[12] >= 0 ? raw.boards[r[12]] : null,
        feature: r[13] >= 0 ? raw.features[r[13]] : null,
        post: r[14] || 0
      };
    }).filter(function (i) { return KINDS[i.kind] && (i.post || RULES[i.system]); });
  }

  // Rechenregel für die Gesamtlänge (Stützenbreite des Artikels vor der Regel des Systems).
  function ruleFor(item) {
    if (item && item.post) return { start: item.post, per: item.post };
    return (item && RULES[item.system]) || RULES['META CLIP'];
  }

  function rowLength(widths, rule) {
    rule = rule || RULES['META CLIP'];
    return widths.reduce(function (n, w) { return n + w + rule.per; }, rule.start);
  }

  // Größte Feldzahl mit gleicher Breite, die in die Länge passt (0, wenn nicht einmal ein Feld passt).
  function fieldCount(length, width, rule) {
    rule = rule || RULES['META CLIP'];
    var n = Math.floor((length - rule.start) / (width + rule.per));
    return Math.max(0, Math.min(CONFIG.maxFields, n));
  }

  function unique(values) {
    return values.filter(function (v, i) { return v != null && values.indexOf(v) === i; });
  }

  function sortNumbers(values) {
    return unique(values).sort(function (a, b) { return a - b; });
  }

  // Nötige Last: bei Palettenregalen das Gewicht je Palette (die „Fachlast" im Namen der MULTIPAL-
  // Palettenregale gilt je Palettenplatz: 980 kg ↔ max. Fachlast 2.930 kg je Ebene mit 3 Paletten),
  // sonst die gewählte Last.
  function requiredLoad(item, q) {
    if (KINDS[q.kind] && KINDS[q.kind].pallet) return q.weight || 0;
    return q.load || 0;
  }

  function ofKind(items, kind, double) {
    return items.filter(function (i) { return i.kind === kind && (double == null || i.double === !!double); });
  }

  // Auswahlwerte je Regalart und Bauform aus der Tabelle.
  function choices(items, kind, double) {
    var list = ofKind(items, kind, double);
    var pick = function (key) { return list.map(function (i) { return i[key]; }); };
    var surfaces = unique(pick('surface'));
    surfaces.sort(function (a, b) { return (a === 'verzinkt' ? 0 : 1) - (b === 'verzinkt' ? 0 : 1) || a.localeCompare(b); });
    return {
      double: unique(ofKind(items, kind).map(function (i) { return i.double; })).sort(),
      h: sortNumbers(pick('h')),
      b: sortNumbers(pick('b')),
      t: sortNumbers(pick('t')),
      load: sortNumbers(pick('load')),
      surface: surfaces,
      board: unique(pick('board')).sort()
    };
  }

  function variantKey(i) {
    return [i.system, i.feature || '', i.levels, i.board || '', i.pallets].join('|');
  }

  function matches(i, q) {
    return i.kind === q.kind && i.double === !!q.double && i.h === q.h && i.t === q.t &&
      (i.surface || null) === (q.surface || null) && (i.board || null) === (q.board || null);
  }

  // Ausführungen (System, Ausstattung, Ebenen, Böden, Last), in denen es Grund- und Anbauregal in der Breite gibt.
  // Ohne allLoads je Ausführung nur die kleinste passende Last.
  function findLines(items, q, allLoads) {
    var groups = {};
    items.forEach(function (i) {
      if (!matches(i, q) || i.load < requiredLoad(i, q)) return;
      var key = variantKey(i) + '|' + i.load;
      var g = groups[key] || (groups[key] = { key: key, variant: variantKey(i), system: i.system, feature: i.feature, levels: i.levels, board: i.board, pallets: i.pallets, load: i.load, base: {}, add: {} });
      (i.base ? g.base : g.add)[i.b] = i;
    });
    // Höhere Last nur als Ersatz: je Ausführung die kleinste passende.
    var lowest = {};
    var lines = Object.keys(groups).map(function (k) { return groups[k]; })
      .filter(function (g) { return g.base[q.b] && g.add[q.b]; });
    lines.forEach(function (g) {
      if (lowest[g.variant] == null || g.load < lowest[g.variant]) lowest[g.variant] = g.load;
    });
    return lines
      .filter(function (g) { return allLoads || g.load === lowest[g.variant]; })
      .map(function (g) {
        return {
          key: g.key, system: g.system, feature: g.feature, lr: g.feature === 'Längsriegel', levels: g.levels, board: g.board,
          pallets: g.pallets, load: g.load, base: g.base[q.b], add: g.add[q.b], rule: ruleFor(g.base[q.b])
        };
      })
      .sort(function (a, b) {
        return (a.load - b.load) || ((a.feature ? 1 : 0) - (b.feature ? 1 : 0)) || a.system.localeCompare(b.system) || b.levels.localeCompare(a.levels);
      });
  }

  // Anbauregale anderer Breiten für gemischte Zeilen: gleiches System, gleiche Ausstattung, Höhe, Tiefe,
  // Farbe und Böden, gleiche Stützenbreite, Last mindestens wie gewünscht (gleiche Last, dann gleiche Ebenen bevorzugt).
  function mixAdds(items, line, q) {
    var best = {};
    items.forEach(function (i) {
      if (i.base || !matches(i, q) || i.system !== line.system || (i.feature || null) !== (line.feature || null)) return;
      if (i.b === q.b || i.load < requiredLoad(i, q) || ruleFor(i).per !== line.rule.per) return;
      var score = (i.load === line.load ? 0 : 2) + (i.levels === line.levels ? 0 : 1);
      var cur = best[i.b];
      if (!cur || score < cur.score) best[i.b] = { item: i, score: score };
    });
    var adds = {};
    adds[q.b] = line.add;
    Object.keys(best).forEach(function (w) { adds[w] = best[w].item; });
    return adds;
  }

  // Beste Zeile aus 1 Grundregal (Breite baseWidth) und Anbauregalen der Breiten in addWidths:
  // möglichst lang, höchstens length; bei gleicher Länge weniger Felder, dann mehr Felder in baseWidth.
  function bestMix(length, baseWidth, addWidths, rule) {
    rule = rule || RULES['META CLIP'];
    var widths = addWidths.slice().sort(function (a, b) { return b - a; });
    var step = function (w) { return w + rule.per; };
    var room = length - rowLength([baseWidth], rule);
    if (room < 0) return null;
    var best = { used: 0, fields: 0, main: 0, counts: {} };
    function better(used, fields, main) {
      if (used !== best.used) return used > best.used;
      if (fields !== best.fields) return fields < best.fields;
      return main > best.main;
    }
    function walk(idx, left, counts, fields) {
      if (fields > CONFIG.maxFields - 1) return;
      if (idx === widths.length - 1) {
        var w = widths[idx];
        var n = Math.min(Math.floor(left / step(w)), CONFIG.maxFields - 1 - fields);
        var c = Object.assign({}, counts);
        c[w] = n;
        var used = room - (left - n * step(w));
        var main = c[baseWidth] || 0;
        if (better(used, fields + n, main)) best = { used: used, fields: fields + n, main: main, counts: c };
        return;
      }
      var wi = widths[idx];
      var max = Math.floor(left / step(wi));
      for (var k = max; k >= 0; k--) {
        var next = Object.assign({}, counts);
        next[wi] = k;
        walk(idx + 1, left - k * step(wi), next, fields + k);
      }
    }
    if (!widths.length) return { widths: [baseWidth], length: rowLength([baseWidth], rule), counts: {} };
    walk(0, room, {}, 0);
    var all = [baseWidth];
    widths.forEach(function (w) { for (var i = 0; i < (best.counts[w] || 0); i++) all.push(w); });
    var counts = {};
    widths.forEach(function (w) { if (best.counts[w]) counts[w] = best.counts[w]; });
    return { widths: all, length: rowLength(all, rule), counts: counts };
  }

  function positionsFor(base, adds, counts) {
    var list = [{ item: base, qty: 1 }];
    Object.keys(counts).map(Number).sort(function (a, b) { return b - a; }).forEach(function (w) {
      if (counts[w] > 0) list.push({ item: adds[w], qty: counts[w] });
    });
    return list;
  }

  // Regalzeile für eine Ausführung: gleiche Breite, dazu wenn sinnvoll eine gemischte Zeile.
  function planLine(items, line, q, length) {
    var rule = line.rule;
    var n = fieldCount(length, q.b, rule);
    if (n < 1) return null;
    var counts = {};
    if (n > 1) counts[q.b] = n - 1;
    var widths = [];
    for (var i = 0; i < n; i++) widths.push(q.b);
    var sameWidth = {};
    sameWidth[q.b] = line.add;
    var main = {
      fields: n,
      length: rowLength(widths, rule),
      nextLength: n < CONFIG.maxFields ? rowLength(widths.concat([q.b]), rule) : null,
      widths: widths,
      positions: positionsFor(line.base, sameWidth, counts)
    };
    var adds = mixAdds(items, line, q);
    var mixWidths = Object.keys(adds).map(Number);
    var mix = null;
    if (mixWidths.length > 1) {
      var m = bestMix(length, q.b, mixWidths, rule);
      var usesOther = m && Object.keys(m.counts).some(function (w) { return Number(w) !== q.b; });
      if (m && usesOther && m.length - main.length >= CONFIG.minMixGainMm) {
        mix = { fields: m.widths.length, length: m.length, widths: m.widths, positions: positionsFor(line.base, adds, m.counts) };
      }
    }
    return { line: line, main: main, mix: mix };
  }

  // Wenn es die Kombination nicht gibt: Werte, mit denen sie es gibt (je ein Merkmal geändert).
  function alternatives(items, q) {
    var result = [];
    var c = choices(items, q.kind, q.double);
    var keys = ['b', 'h', 't', 'surface', 'board'];
    if (!KINDS[q.kind].pallet) keys.push('load');
    keys.forEach(function (key) {
      c[key].forEach(function (v) {
        if (v === q[key]) return;
        var alt = Object.assign({}, q);
        alt[key] = v;
        if (findLines(items, alt).length) result.push({ key: key, value: v });
      });
    });
    var other = Object.assign({}, q, { double: !q.double });
    if (findLines(items, other).length) result.push({ key: 'double', value: !q.double });
    if (KINDS[q.kind].pallet) {
      // Höchstes Palettengewicht, das es in diesen Maßen gibt
      var max = findLines(items, Object.assign({}, q, { weight: 0 }), true).reduce(function (m, l) { return Math.max(m, l.load); }, 0);
      if (max && max < (q.weight || 0)) result.unshift({ key: 'weight', value: max });
    }
    return result;
  }

  // Regalart, Maße und Ausführung eines Artikels für den Link von der Produktseite.
  function parseShelfName(name) {
    var text = String(name || '').replace(/\s+/g, ' ').trim();
    var seg = text.split(' | ');
    if (seg.length < 5 || !/^(Doppel-)?(Grund|Anbau)regal$/.test(seg[2])) return null;
    var kind = KIND_ORDER.filter(function (k) { return KINDS[k].type === seg[1] && KINDS[k].systems.indexOf(seg[0]) >= 0; })[0];
    var dims = text.match(/\| (\d+) x (\d+) x (\d+) mm/);
    if (!kind || !dims) return null;
    var load = text.match(/\| (?:Fachlast|Armlast) (\d+) kg/);
    var surface = seg.filter(function (s) { return /^(verzinkt|RAL \d{4})$/.test(s); })[0] || null;
    var board = /Spanplattenböden/.test(text) ? 'Spanplatte' : /Stahlpaneel/.test(text) ? 'Stahlpaneel' : null;
    var q = {
      kind: kind,
      h: Number(dims[1]),
      b: Number(dims[2]),
      t: Number(dims[3]),
      surface: surface,
      double: /^Doppel-/.test(seg[2]) || seg.indexOf('doppelseitig') >= 0
    };
    if (board) q.board = board;
    if (load && !KINDS[kind].pallet) q.load = Number(load[1]);
    return q;
  }

  var PARAMS = {
    kind: 'regalart', h: 'hoehe', b: 'breite', t: 'tiefe', load: 'last', weight: 'palettengewicht',
    surface: 'farbe', board: 'boden', double: 'bauform', length: 'laenge'
  };

  function toQuery(q) {
    var parts = [];
    Object.keys(PARAMS).forEach(function (key) {
      var v = q[key];
      if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return;
      if (key === 'double') v = v ? 'doppel' : 'einzel';
      parts.push(PARAMS[key] + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function readQuery(search) {
    var q = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = decodeURIComponent((i < 0 ? pair : pair.slice(0, i)).replace(/\+/g, ' '));
      var v = decodeURIComponent((i < 0 ? '' : pair.slice(i + 1)).replace(/\+/g, ' '));
      // Adressen der ersten Fassung (nur Fachbodenregale) gelten weiter
      if (k === 'fachlast') k = 'last';
      Object.keys(PARAMS).forEach(function (key) {
        if (PARAMS[key] !== k) return;
        if (key === 'double') q.double = v === 'doppel';
        else if (key === 'surface' || key === 'board' || key === 'kind') q[key] = v;
        else if (key === 'length') q.length = parseLength(v);
        else if (key === 'weight') q.weight = parseWeight(v);
        else if (isFinite(Number(v)) && v !== '') q[key] = Number(v);
      });
    });
    return q;
  }

  function closest(values, v) {
    if (!values.length) return null;
    if (v == null || !isFinite(v)) return values[0];
    return values.reduce(function (best, x) { return Math.abs(x - v) < Math.abs(best - v) ? x : best; }, values[0]);
  }

  function availableKinds(items) {
    return KIND_ORDER.filter(function (k) { return items.some(function (i) { return i.kind === k; }); });
  }

  // Werte der Auswahl auf vorhandene setzen (Last: nächsthöhere, sonst höchste).
  function normalizeQuery(items, q) {
    var kinds = availableKinds(items);
    var kind = kinds.indexOf(q.kind) >= 0 ? q.kind : kinds[0];
    var def = KINDS[kind].defaults;
    var sides = choices(items, kind).double;
    var double = sides.indexOf(!!q.double) >= 0 ? !!q.double : sides[0];
    var c = choices(items, kind, double);
    var wantLoad = q.load != null ? q.load : def.load || 0;
    var load = c.load.filter(function (v) { return v >= wantLoad; })[0];
    var pick = function (key) { return c[key].indexOf(q[key]) >= 0 ? q[key] : closest(c[key], q[key] != null ? q[key] : def[key]); };
    var result = {
      kind: kind,
      double: double,
      h: pick('h'),
      b: pick('b'),
      t: pick('t'),
      surface: c.surface.indexOf(q.surface) >= 0 ? q.surface : (c.surface[0] || null),
      board: c.board.indexOf(q.board) >= 0 ? q.board : (c.board[0] || null),
      length: q.length || null
    };
    if (KINDS[kind].pallet) result.weight = q.weight || def.weight;
    else result.load = load != null ? load : c.load[c.load.length - 1];
    return result;
  }

  var api = {
    config: CONFIG,
    kinds: KINDS,
    rules: RULES,
    parseLength: parseLength,
    decodeCatalog: decodeCatalog,
    ruleFor: ruleFor,
    rowLength: rowLength,
    fieldCount: fieldCount,
    choices: choices,
    findLines: findLines,
    bestMix: bestMix,
    planLine: planLine,
    alternatives: alternatives,
    parseShelfName: parseShelfName,
    toQuery: toQuery,
    readQuery: readQuery,
    normalizeQuery: normalizeQuery
  };
  if (typeof window === 'undefined' || typeof document === 'undefined') return api;
  if (CONFIG.salesChannelIds.indexOf(window.salesChannelId) === -1) return api;

  var path = window.location.pathname.replace(/\/+$/, '') || '/';
  var idCounter = 0;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ---------- Preise aus der Produktseite (Sitzung des Kunden) ----------

  var productCache = {};

  function loadProduct(id) {
    if (!productCache[id]) {
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, CONFIG.timeoutMs) : null;
      productCache[id] = fetch('/detail/' + id, { credentials: 'same-origin', signal: controller ? controller.signal : undefined })
        .then(function (res) {
          if (!res.ok) throw new Error(String(res.status));
          var url = res.url;
          return res.text().then(function (html) { return { html: html, url: url }; });
        })
        .then(function (r) {
          var doc = new DOMParser().parseFromString(r.html, 'text/html');
          var meta = doc.querySelector('meta[itemprop="price"]');
          var price = meta ? Number(meta.getAttribute('content')) : NaN;
          var name = doc.querySelector('.product-detail-name');
          var tax = doc.querySelector('.product-detail-tax');
          var delivery = doc.querySelector('.product-detail-buy .delivery-information');
          return {
            id: id,
            ok: true,
            href: r.url,
            name: name ? name.textContent.replace(/\s+/g, ' ').trim() : '',
            price: isFinite(price) ? price : null,
            buyable: !!doc.querySelector('form.buy-widget[action*="/checkout/line-item/add"]'),
            tax: tax ? tax.textContent.replace(/\s+/g, ' ').trim() : '',
            delivery: delivery ? delivery.textContent.replace(/\s+/g, ' ').trim() : ''
          };
        })
        .catch(function () {
          delete productCache[id];
          return { id: id, ok: false, href: '/detail/' + id, price: null, buyable: false };
        })
        .then(function (p) {
          if (timer) clearTimeout(timer);
          return p;
        });
    }
    return productCache[id];
  }

  // ---------- Warenkorb ----------

  function hidden(form, name, value) {
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  function cartForm(positions, label) {
    var form = el('form', 'meta-qc__cart');
    form.action = '/checkout/line-item/add';
    form.method = 'post';
    form.setAttribute('data-add-to-cart', 'true');
    hidden(form, 'redirectTo', 'frontend.cart.offcanvas');
    positions.forEach(function (p) {
      var key = 'lineItems[' + p.item.id + ']';
      hidden(form, key + '[id]', p.item.id);
      hidden(form, key + '[type]', 'product');
      hidden(form, key + '[referencedId]', p.item.id);
      hidden(form, key + '[quantity]', String(p.qty));
      hidden(form, key + '[stackable]', '1');
      hidden(form, key + '[removable]', '1');
    });
    var button = el('button', 'btn btn-primary meta-qc__buy', label);
    button.type = 'submit';
    form.appendChild(button);
    return form;
  }

  function initCartForm(form) {
    try {
      window.PluginManager.initializePlugin('AddToCart', form);
    } catch (e) {
      // Ohne Shopware-Plugin normal absenden und zum Warenkorb wechseln.
      form.removeAttribute('data-add-to-cart');
      form.querySelector('input[name="redirectTo"]').value = 'frontend.checkout.cart.page';
    }
  }

  // ---------- Konfigurator-Seite ----------

  function lineTitle(line, q) {
    var load = KINDS[q.kind].pallet ? 'bis ' + formatNumber(line.load) + ' kg je Palette' : KINDS[q.kind].load + ' ' + formatNumber(line.load) + ' kg';
    // „6+0 Ebenen" (Büroregale ohne Abdeckboden) als „6 Ebenen"
    return line.system + ' · ' + String(line.levels).replace(/\+0$/, '') + ' Ebenen · ' + load;
  }

  function lineFacts(line, q) {
    var facts = [];
    if (TEXT.frame[line.system]) facts.push(TEXT.frame[line.system]);
    if (q.kind === 'fachboden') {
      var bracing = q.double ? (line.lr ? 'doubleLr' : 'doubleDiagonal') : (line.lr ? 'lr' : 'diagonal');
      facts.push(TEXT.bracing[bracing]);
    }
    if (q.kind === 'kragarm') facts.push(q.double ? 'Doppelseitig: Kragarme auf beiden Seiten' : 'Einseitig: Kragarme auf einer Seite');
    if (line.feature && q.kind !== 'fachboden') facts.push('Mit ' + line.feature);
    if (line.board) facts.push('Böden: ' + line.board);
    if (line.pallets) facts.push(line.pallets + ' Palettenplätze je Feld inkl. Bodenebene');
    return facts;
  }

  function widthsText(widths) {
    var counts = {};
    widths.forEach(function (w) { counts[w] = (counts[w] || 0) + 1; });
    return Object.keys(counts).map(Number).sort(function (a, b) { return b - a; })
      .map(function (w) { return counts[w] + ' × ' + formatNumber(w); }).join(' + ') + ' mm';
  }

  function renderPlan(card, plan, q, line) {
    var body = card.querySelector('.meta-qc__plan');
    body.innerHTML = '';
    var summary = el('p', 'meta-qc__summary');
    var strong = el('strong', null, plan.fields + (plan.fields === 1 ? ' Feld' : ' Felder') + ' · Gesamtlänge ca. ' + formatMm(plan.length));
    summary.appendChild(strong);
    var extra = ' (' + widthsText(plan.widths) + ', ' + formatMm(q.length - plan.length) + ' Platz übrig';
    var places = plan.positions.reduce(function (n, p) { return n + (p.item.pallets || 0) * p.qty; }, 0);
    if (places) extra += ', ' + formatNumber(places) + ' Palettenplätze';
    summary.appendChild(document.createTextNode(extra + ')'));
    body.appendChild(summary);
    var minFields = KINDS[q.kind].minFields;
    if (minFields && plan.fields < minFields) {
      body.appendChild(el('p', 'meta-qc__hint', 'Laut META-Katalog gelten die Fach- und Feldlasten für Regalzeilen ab ' + minFields + ' Feldern.'));
    }

    var table = el('table', 'meta-qc__positions');
    var caption = el('caption', 'visually-hidden', 'Artikel dieser Regalzeile');
    table.appendChild(caption);
    var tbody = el('tbody');
    var rows = plan.positions.map(function (p) {
      var tr = el('tr');
      tr.appendChild(el('td', 'meta-qc__qty', p.qty + ' ×'));
      var nameCell = el('td', 'meta-qc__name');
      var link = el('a', null, p.item.role + ' ' + p.item.h + ' × ' + p.item.b + ' × ' + p.item.t + ' mm');
      link.href = '/detail/' + p.item.id;
      nameCell.appendChild(link);
      tr.appendChild(nameCell);
      var priceCell = el('td', 'meta-qc__price', '…');
      tr.appendChild(priceCell);
      tbody.appendChild(tr);
      return { p: p, link: link, priceCell: priceCell };
    });
    table.appendChild(tbody);
    body.appendChild(table);

    var total = el('p', 'meta-qc__total', 'Preise werden geladen …');
    body.appendChild(total);
    var actions = el('div', 'meta-qc__actions');
    body.appendChild(actions);

    var token = String(++idCounter);
    card.setAttribute('data-plan', token);
    return Promise.all(plan.positions.map(function (p) { return loadProduct(p.item.id); })).then(function (products) {
      if (card.getAttribute('data-plan') !== token) return null;
      var sum = 0;
      var complete = true;
      products.forEach(function (prod, i) {
        var r = rows[i];
        if (prod.ok) {
          r.link.href = prod.href;
          if (prod.name) r.link.title = prod.name;
        }
        if (prod.price == null) {
          complete = false;
          r.priceCell.textContent = '–';
        } else {
          sum += prod.price * r.p.qty;
          r.priceCell.textContent = (r.p.qty > 1 ? r.p.qty + ' × ' + formatPrice(prod.price) + ' = ' : '') + formatPrice(prod.price * r.p.qty);
        }
      });
      total.innerHTML = '';
      if (complete) {
        total.appendChild(el('strong', null, 'Summe ' + formatPrice(sum)));
        var tax = products[0].tax;
        if (tax) total.appendChild(el('span', 'meta-qc__tax', tax));
      } else {
        total.textContent = 'Preis bitte auf den Produktseiten ansehen.';
      }
      var delivery = products.map(function (p) { return p.delivery; }).filter(Boolean);
      if (delivery.length) body.insertBefore(el('p', 'meta-qc__delivery', delivery[0]), actions);
      var buyable = products.every(function (p) { return p.ok && p.buyable; });
      if (buyable) {
        var form = cartForm(plan.positions, 'Alle ' + plan.positions.reduce(function (n, p) { return n + p.qty; }, 0) + ' Regale in den Warenkorb');
        actions.appendChild(form);
        initCartForm(form);
      } else {
        actions.appendChild(el('p', 'meta-qc__note', 'Nicht alle Artikel sind direkt bestellbar – bitte über die Produktseiten anfragen.'));
      }
      return complete ? sum : null;
    });
  }

  function renderLine(result, q) {
    var card = el('article', 'meta-qc__line');
    var headingId = 'meta-qc-line-' + (++idCounter);
    card.setAttribute('aria-labelledby', headingId);
    var head = el('div', 'meta-qc__line-head');
    var h3 = el('h3', 'meta-qc__line-title', lineTitle(result.line, q));
    h3.id = headingId;
    head.appendChild(h3);
    card.appendChild(head);
    var facts = el('ul', 'meta-qc__facts');
    lineFacts(result.line, q).forEach(function (f) { facts.appendChild(el('li', null, f)); });
    if (!KINDS[q.kind].pallet && result.line.load > q.load) {
      facts.appendChild(el('li', 'meta-qc__hint', KINDS[q.kind].load + ' ' + formatNumber(result.line.load) + ' kg – mehr als gewünscht, in ' + formatNumber(q.load) + ' kg gibt es diese Ausführung nicht'));
    }
    card.appendChild(facts);

    var plan = el('div', 'meta-qc__plan');
    card.appendChild(plan);

    var current = result.main;
    if (result.mix) {
      var toggle = el('div', 'meta-qc__mix');
      var text = el('p', null, 'Mit gemischten Breiten (' + widthsText(result.mix.widths) + ') wird die Zeile ' + formatMm(result.mix.length) + ' lang, ' + formatMm(result.mix.length - result.main.length) + ' mehr.');
      var button = el('button', 'btn btn-outline-primary btn-sm', 'Gemischte Breiten zeigen');
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', function () {
        current = current === result.main ? result.mix : result.main;
        var mixed = current === result.mix;
        button.setAttribute('aria-pressed', mixed ? 'true' : 'false');
        button.textContent = mixed ? 'Nur ' + formatMm(q.b) + ' zeigen' : 'Gemischte Breiten zeigen';
        renderPlan(card, current, q, result.line);
      });
      toggle.appendChild(text);
      toggle.appendChild(button);
      card.appendChild(toggle);
    } else if (result.main.nextLength) {
      card.appendChild(el('p', 'meta-qc__note', 'Mit einem Feld mehr wäre die Zeile ' + formatMm(result.main.nextLength) + ' lang.'));
    }
    return { card: card, ready: renderPlan(card, current, q, result.line) };
  }

  function label(kind, key) {
    var k = KINDS[kind];
    return { h: 'Höhe', b: k.width, t: k.depth, load: k.load, surface: 'Farbe', board: 'Böden', double: 'Bauform', weight: 'Gewicht je Palette' }[key];
  }

  function valueText(kind, key, v) {
    if (key === 'surface') return surfaceLabel(v);
    if (key === 'board') return v;
    if (key === 'double') return (KINDS[kind].sides || ['Einzelregal', 'Doppelregal'])[v ? 1 : 0];
    if (key === 'load' || key === 'weight') return formatNumber(v) + ' kg';
    return formatMm(v);
  }

  var LENGTH_TEXT = {
    label: 'Maximale Regallänge',
    hint: '= Ihr verfügbarer Platz, z. B. die Wandlänge. Die Regalzeile wird höchstens so lang.',
    missing: 'Bitte die maximale Regallänge eingeben – also wie viel Platz Sie für das Regal haben.'
  };

  // Hervorgehobenes Feld für die maximale Regallänge (verfügbarer Platz), auf Seite und Startseite gleich.
  function lengthField(id, value) {
    var box = el('div', 'meta-qc-length');
    var lab = el('label', 'meta-qc-length__label', LENGTH_TEXT.label);
    lab.htmlFor = id;
    box.appendChild(lab);
    var hint = el('p', 'meta-qc-length__hint', LENGTH_TEXT.hint);
    hint.id = id + '-hint';
    box.appendChild(hint);
    var wrap = el('div', 'meta-qc-length__input');
    var input = el('input', 'form-control');
    input.id = id;
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.placeholder = 'z. B. 5000';
    input.setAttribute('aria-describedby', hint.id);
    if (value) input.value = String(value);
    wrap.appendChild(input);
    var unit = el('span', 'meta-qc-length__unit', 'mm');
    unit.setAttribute('aria-hidden', 'true');
    wrap.appendChild(unit);
    // Wer selbst eine Einheit schreibt („5,2 m"), braucht das „mm" dahinter nicht
    var syncUnit = function () { unit.hidden = /[a-z]\s*$/i.test(input.value); };
    input.addEventListener('input', syncUnit);
    syncUnit();
    box.appendChild(wrap);
    return { box: box, input: input };
  }

  function markLength(box, input, empty) {
    box.classList.toggle('is-empty', !!empty);
    if (empty) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function mount(root, items) {
    var q = normalizeQuery(items, readQuery(window.location.search));
    root.innerHTML = '';
    root.classList.add('meta-qc--ready');

    var form = el('form', 'meta-qc__form');
    form.setAttribute('novalidate', 'novalidate');
    form.addEventListener('submit', function (e) { e.preventDefault(); update(); });
    root.appendChild(form);

    var status = el('p', 'meta-qc__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    root.appendChild(status);
    var results = el('div', 'meta-qc__results');
    root.appendChild(results);

    var fields = {};
    var lengthInput = null;
    var lengthBox = null;
    var weightInput = null;

    function field(key, text, control, hint) {
      var wrap = el('div', 'meta-qc__field meta-qc__field--' + key);
      var id = 'meta-qc-' + key;
      var lab = el('label', 'meta-qc__label', text);
      lab.htmlFor = id;
      control.id = id;
      wrap.appendChild(lab);
      wrap.appendChild(control);
      if (hint) {
        var h = el('span', 'meta-qc__field-hint', hint);
        h.id = id + '-hint';
        control.setAttribute('aria-describedby', h.id);
        wrap.appendChild(h);
      }
      form.appendChild(wrap);
      fields[key] = control;
      return control;
    }

    function select(key, values) {
      var s = el('select', 'form-select');
      values.forEach(function (v) {
        var opt = el('option', null, valueText(q.kind, key, v));
        opt.value = String(v);
        s.appendChild(opt);
      });
      s.value = String(q[key]);
      return s;
    }

    function textInput(placeholder, value) {
      var input = el('input', 'form-control');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.placeholder = placeholder;
      if (value) input.value = String(value);
      return input;
    }

    // Formular je Regalart neu aufbauen (Felder und Beschriftungen unterscheiden sich).
    function buildForm() {
      var typed = lengthInput ? lengthInput.value : (q.length ? String(q.length) : '');
      form.innerHTML = '';
      fields = {};
      // Länge zuerst und hervorgehoben: ohne sie gibt es kein Ergebnis
      var len = lengthField('meta-qc-length', typed);
      lengthBox = len.box;
      lengthInput = len.input;
      form.appendChild(lengthBox);
      lengthInput.addEventListener('input', onTyping);
      var kindSelect = el('select', 'form-select');
      availableKinds(items).forEach(function (k) {
        var opt = el('option', null, KINDS[k].label);
        opt.value = k;
        kindSelect.appendChild(opt);
      });
      kindSelect.value = q.kind;
      field('kind', 'Regalart', kindSelect);
      var c = choices(items, q.kind, q.double);
      if (choices(items, q.kind).double.length > 1) field('double', 'Bauform', select('double', [false, true]));
      ['h', 'b', 't'].forEach(function (key) { field(key, label(q.kind, key), select(key, c[key])); });
      if (KINDS[q.kind].pallet) {
        weightInput = field('weight', 'Gewicht je Palette in kg', textInput('z. B. 800', q.weight));
      } else {
        weightInput = null;
        field('load', label(q.kind, 'load'), select('load', c.load));
      }
      if (c.surface.length > 1) field('surface', 'Farbe', select('surface', c.surface));
      if (c.board.length > 1) field('board', 'Böden', select('board', c.board));
      if (weightInput) weightInput.addEventListener('input', onTyping);
    }

    function readForm() {
      var next = Object.assign({}, q);
      var kindChanged = fields.kind.value !== q.kind;
      next.kind = fields.kind.value;
      if (fields.double) next.double = fields.double.value === 'true';
      ['h', 'b', 't', 'load'].forEach(function (key) { if (fields[key]) next[key] = Number(fields[key].value); });
      if (fields.surface) next.surface = fields.surface.value;
      if (fields.board) next.board = fields.board.value;
      if (weightInput) next.weight = parseWeight(weightInput.value);
      next.length = parseLength(lengthInput.value);
      if (kindChanged) next = { kind: next.kind, length: next.length };
      var weight = next.weight;
      q = normalizeQuery(items, next);
      if (KINDS[q.kind].pallet && !kindChanged) q.weight = weight;
      return kindChanged || next.double !== q.double;
    }

    var typing = null;
    function onTyping() {
      clearTimeout(typing);
      typing = setTimeout(function () { readForm(); update(); }, 400);
    }

    function setQuery(change) {
      q = normalizeQuery(items, Object.assign({}, q, change));
      buildForm();
      update();
    }

    function update() {
      results.innerHTML = '';
      try { window.history.replaceState(null, '', window.location.pathname + toQuery(q)); } catch (e) { /* still */ }
      var kind = KINDS[q.kind];
      if (kind.pallet && !q.weight) {
        status.textContent = 'Bitte das Gewicht je Palette eingeben.';
        return;
      }
      var lines = findLines(items, q);
      if (!lines.length) {
        status.textContent = kind.pallet
          ? 'Für ' + formatNumber(q.weight) + ' kg je Palette gibt es diese Kombination nicht als Standardregal.'
          : 'Diese Kombination gibt es nicht als Standardregal.';
        var alts = alternatives(items, q);
        if (alts.length) {
          var box = el('div', 'meta-qc__alts');
          box.appendChild(el('p', null, 'Verfügbar mit:'));
          var list = el('ul', 'meta-qc__chips');
          alts.forEach(function (a) {
            var li = el('li');
            var b = el('button', 'meta-qc__chip', label(q.kind, a.key) + (a.key === 'weight' ? ' bis ' : ' ') + valueText(q.kind, a.key, a.value));
            b.type = 'button';
            b.addEventListener('click', function () {
              var change = {};
              change[a.key] = a.value;
              setQuery(change);
            });
            li.appendChild(b);
            list.appendChild(li);
          });
          box.appendChild(list);
          results.appendChild(box);
        }
        return;
      }
      markLength(lengthBox, lengthInput, !q.length);
      if (!q.length) {
        status.textContent = LENGTH_TEXT.missing;
        return;
      }
      var planned = lines.slice(0, CONFIG.maxLines).map(function (line) { return planLine(items, line, q, q.length); }).filter(Boolean);
      if (!planned.length) {
        var single = rowLength([q.b], lines[0].rule);
        status.textContent = 'Ein Grundregal mit ' + formatMm(q.b) + ' ' + kind.width + ' ist ca. ' + formatMm(single) + ' lang, also länger als die maximale Regallänge von ' + formatMm(q.length) + '.';
        return;
      }
      var first = planned[0];
      status.textContent = 'Für max. ' + formatMm(q.length) + ' Regallänge: ' + first.main.fields + (first.main.fields === 1 ? ' Feld' : ' Felder') +
        ' mit ' + formatMm(q.b) + ' ' + kind.width + ', Gesamtlänge ca. ' + formatMm(first.main.length) + '.' +
        (planned.length > 1 ? ' ' + planned.length + ' Ausführungen zur Auswahl.' : '');
      if (kind.tipping && !q.double && q.h / q.t > 4) {
        results.appendChild(el('p', 'meta-qc__warning', 'Höhe zu Tiefe über 4 : 1 – laut META-Katalog das Regal mit Wand- oder Fußverankerung gegen Kippen sichern.'));
      }
      if (kind.pallet) {
        results.appendChild(el('p', 'meta-qc__warning', 'Laut META-Katalog werden Palettenregale auf Beton (mindestens C20/25) aufgestellt und mit Ankern fixiert; Grund- und Anbauregale enthalten die Bodenanker.'));
      }
      var cards = planned.map(function (p) {
        var r = renderLine(p, q);
        results.appendChild(r.card);
        return r;
      });
      Promise.all(cards.map(function (c) { return c.ready; })).then(function (sums) {
        if (cards.length < 2 || sums.some(function (s) { return s == null; })) return;
        var min = Math.min.apply(null, sums);
        var i = sums.indexOf(min);
        var badge = el('span', 'meta-qc__badge', 'Günstigste Ausführung');
        cards[i].card.querySelector('.meta-qc__line-head').appendChild(badge);
      });
      results.appendChild(el('p', 'meta-qc__footnote', kind.lengthNote + ' Zubehör finden Sie auf den Produktseiten unter „Das passt dazu".'));
    }

    form.addEventListener('change', function (e) {
      if (e.target === lengthInput || e.target === weightInput) return;
      if (readForm()) buildForm();
      else if (e.target === fields.kind || e.target === fields.double) buildForm();
      update();
    });

    buildForm();
    update();
  }

  function startPage() {
    var root = document.querySelector('[data-meta-quick-config]');
    if (!root || root.classList.contains('meta-qc--ready')) return;
    var src = root.getAttribute('data-catalog');
    var fail = function () {
      root.innerHTML = '';
      root.appendChild(el('p', 'meta-qc__error', 'Der Schnellkonfigurator ist gerade nicht verfügbar. Alle Regale finden Sie über das Menü.'));
      var link = el('a', 'btn btn-primary', 'Zu den Fachbodenregalen');
      link.href = '/fachbodenregale/';
      root.appendChild(link);
    };
    if (!src) return fail();
    fetch(src, { credentials: 'same-origin' })
      .then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
      .then(function (raw) {
        var items = decodeCatalog(raw);
        if (!items.length) throw new Error('leer');
        mount(root, items);
      })
      .catch(fail);
  }

  // ---------- Startseite: kleines Formular, führt zur Konfigurator-Seite ----------

  function startHome() {
    var root = document.querySelector('[data-meta-quick-config-home]');
    if (!root || root.classList.contains('meta-qc-home--ready')) return;
    var options;
    try { options = JSON.parse(root.getAttribute('data-options') || '{}'); } catch (e) { return; }
    var kinds = KIND_ORDER.filter(function (k) { return options[k] && options[k].h && options[k].h.length; });
    if (!kinds.length) return;
    root.classList.add('meta-qc-home--ready');
    var form = root.querySelector('form.meta-qc-home__form');
    if (!form) return;
    form.innerHTML = '';
    var state = { kind: kinds[0] };

    function control(key, text, node, wide) {
      var wrap = el('div', 'meta-qc__field meta-qc-home__field meta-qc-home__field--' + key + (wide ? ' meta-qc-home__field--wide' : ''));
      var id = 'meta-qc-home-' + key;
      var lab = el('label', 'meta-qc__label', text);
      lab.htmlFor = id;
      node.id = id;
      wrap.appendChild(lab);
      wrap.appendChild(node);
      return wrap;
    }

    function selectOf(values, current, format) {
      var s = el('select', 'form-select');
      values.forEach(function (v) {
        var opt = el('option', null, format(v));
        opt.value = String(v);
        s.appendChild(opt);
      });
      s.value = String(closest(values, current));
      return s;
    }

    var refs = {};
    function build() {
      var keep = refs.length ? refs.length.value : '';
      form.innerHTML = '';
      var kind = KINDS[state.kind];
      var o = options[state.kind];
      var kindSelect = el('select', 'form-select');
      kinds.forEach(function (k) {
        var opt = el('option', null, KINDS[k].label);
        opt.value = k;
        kindSelect.appendChild(opt);
      });
      kindSelect.value = state.kind;
      kindSelect.addEventListener('change', function () { state.kind = kindSelect.value; build(); });
      refs = {};
      // Länge als eigene Zeile über den übrigen Feldern: ohne sie gibt es kein Ergebnis
      var len = lengthField('meta-qc-home-length', keep);
      refs.length = len.input;
      refs.lengthBox = len.box;
      refs.length.addEventListener('input', function () {
        markLength(refs.lengthBox, refs.length, false);
        var error = refs.lengthBox.querySelector('.meta-qc-length__error');
        if (error) error.parentNode.removeChild(error);
      });
      form.appendChild(len.box);
      form.appendChild(control('kind', 'Regalart', kindSelect));
      refs.h = selectOf(o.h, kind.defaults.h, formatMm);
      refs.b = selectOf(o.b, kind.defaults.b, formatMm);
      refs.t = selectOf(o.t, kind.defaults.t, formatMm);
      form.appendChild(control('h', 'Höhe', refs.h));
      form.appendChild(control('b', kind.width, refs.b));
      form.appendChild(control('t', kind.depth, refs.t));
      if (kind.pallet) {
        refs.weight = el('input', 'form-control');
        refs.weight.type = 'text';
        refs.weight.inputMode = 'decimal';
        refs.weight.value = String(kind.defaults.weight);
        form.appendChild(control('weight', 'Gewicht je Palette (kg)', refs.weight));
      } else {
        refs.load = selectOf(o.load, kind.defaults.load, function (v) { return formatNumber(v) + ' kg'; });
        form.appendChild(control('load', kind.load, refs.load));
      }
      var button = el('button', 'btn btn-primary meta-qc-home__submit', 'Regalzeile berechnen');
      button.type = 'submit';
      var actions = el('div', 'meta-qc-home__actions');
      actions.appendChild(button);
      form.appendChild(actions);
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      // Ohne Länge gibt es kein Ergebnis: Feld markieren statt leer weiterleiten
      if (!parseLength(refs.length.value)) {
        markLength(refs.lengthBox, refs.length, true);
        var error = refs.lengthBox.querySelector('.meta-qc-length__error');
        if (!error) {
          error = el('p', 'meta-qc-length__error', LENGTH_TEXT.missing);
          error.setAttribute('role', 'alert');
          refs.lengthBox.appendChild(error);
        }
        refs.length.focus();
        return;
      }
      var q = {
        kind: state.kind,
        h: Number(refs.h.value),
        b: Number(refs.b.value),
        t: Number(refs.t.value),
        length: parseLength(refs.length.value)
      };
      if (refs.weight) q.weight = parseWeight(refs.weight.value);
      else q.load = Number(refs.load.value);
      window.location.href = CONFIG.pagePath + toQuery(q);
    });
    build();
  }

  // ---------- Einstiegskasten und Produktseite ----------

  function teaserKind() {
    return KIND_ORDER.filter(function (k) { return KINDS[k].paths.indexOf(path) >= 0; })[0];
  }

  function startTeaser() {
    var kind = teaserKind();
    if (!kind || document.querySelector('.meta-qc-teaser')) return;
    var k = KINDS[kind];
    var box = el('aside', 'meta-qc-teaser');
    box.setAttribute('aria-label', 'Regal-Schnellkonfigurator');
    var text = el('div', 'meta-qc-teaser__text');
    text.appendChild(el('p', 'meta-qc-teaser__title', k.label + '-Zeile in einer Minute berechnen'));
    text.appendChild(el('p', 'meta-qc-teaser__body', 'Höhe, ' + k.width + ', ' + k.depth + ', ' + (k.pallet ? 'Gewicht je Palette' : k.load) +
      ' und maximale Regallänge eingeben – der Schnellkonfigurator stellt Grund- und Anbauregale zusammen und legt sie in den Warenkorb.'));
    box.appendChild(text);
    var link = el('a', 'btn btn-primary meta-qc-teaser__link', 'Zum Schnellkonfigurator');
    link.href = CONFIG.pagePath + toQuery({ kind: kind });
    box.appendChild(link);

    var listing = document.querySelector('.cms-section-sidebar-main-content');
    if (listing) {
      listing.insertBefore(box, listing.firstChild);
      return;
    }
    var sections = document.querySelectorAll('.cms-sections > .cms-section');
    if (!sections.length) return;
    var wrap = el('div', 'meta-qc-teaser-wrap container');
    wrap.appendChild(box);
    sections[0].insertAdjacentElement('afterend', wrap);
  }

  function startProduct() {
    var buy = document.querySelector('.product-detail-buy');
    var title = buy && (buy.querySelector('.product-detail-name') || document.querySelector('h1.product-detail-name'));
    if (!title || document.querySelector('.meta-qc-product')) return;
    var shelf = parseShelfName(title.textContent);
    if (!shelf) return;
    var anchor = buy.querySelector('.product-detail-form-container');
    if (!anchor) return;
    var box = el('div', 'meta-qc-product');
    var link = el('a', 'meta-qc-product__link', 'Regalzeile mit diesen Maßen berechnen');
    link.href = CONFIG.pagePath + toQuery(shelf);
    box.appendChild(link);
    box.appendChild(el('span', 'meta-qc-product__text', 'Wie viele Grund- und Anbauregale passen auf Ihre Länge?'));
    anchor.insertAdjacentElement('afterend', box);
  }

  function start() {
    if (path === CONFIG.pagePath) startPage();
    else startTeaser();
    startHome();
    startProduct();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return api;
})();
