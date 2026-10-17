/*
 * METAorder: Regal-Schnellkonfigurator für META CLIP und META CLIP S3 Fachbodenregale.
 *
 * Quelle: shopware/storefront-snippets/quick-configurator.js im METAorder-Repo.
 * Eingespielt über das Plugin „Eigenes CSS/JS" (DneCustomCssJs) per
 * scripts/writeQuickConfigurator.ts. Änderungen im Shop-Admin überschreibt der nächste Lauf.
 *
 * Drei Stellen im Shop:
 * - Seite /regal-schnellkonfigurator (Erlebniswelt aus scripts/writeQuickConfiguratorPage.ts):
 *   Höhe, Feldbreite, Tiefe, Fachlast, Farbe, Bauform und verfügbare Länge eingeben. Das Skript
 *   stellt die Regalzeile aus 1 Grundregal und n Anbauregalen zusammen (so lang wie möglich, nie
 *   länger als angegeben), zeigt bei Bedarf eine Zeile mit gemischten Feldbreiten, holt die Preise in
 *   der Sitzung des Kunden von den Produktseiten (Händler- und Kundenpreise stimmen) und legt alles
 *   mit einem Klick in den Warenkorb.
 * - Einstiegskasten auf der Fachbodenregal-Seite und den CLIP-Listen.
 * - Produktseite eines CLIP-Regals: Link zum Konfigurator mit den Maßen des Artikels.
 *
 * Die Artikeltabelle (Datei in den Shop-Medien) steht im Attribut data-catalog der Seite und wird
 * nur dort geladen. Fehler bleiben still: ohne Tabelle erscheint ein Hinweis statt des Formulars.
 */
var MetaQuickConfigurator = (function () {
  'use strict';

  var CONFIG = {
    version: '1',
    // Nur der Onlineshop „META Regalbau DE" (gleiche ID im Testshop und im Live-Shop).
    salesChannelIds: ['018ec134507f703b82a76467791e7e61'],
    pagePath: '/regal-schnellkonfigurator',
    teaserPaths: ['/fachbodenregale', '/clip-grundregale', '/clip-anbauregale', '/clip-komplettregale'],
    // Breite eines Ständerrahmens; Gesamtlänge = Feldbreiten + (Felder + 1) × Rahmen (wie im Regalplaner).
    postMm: 40,
    // Gemischte Feldbreiten nur zeigen, wenn die Zeile damit spürbar länger wird.
    minMixGainMm: 100,
    maxFields: 60,
    maxLines: 4,
    timeoutMs: 10000,
    productName: /^META CLIP( S3)? \| Fachbodenregal \| (Doppel-)?(Grund|Anbau)regal \|/
  };

  var TEXT = {
    surface: { 'verzinkt': 'Verzinkt', 'RAL 7035': 'RAL 7035 lichtgrau', 'RAL 9005': 'RAL 9005 tiefschwarz' },
    frame: {
      'META CLIP': 'Rahmen vorgefertigt (geclincht), fertig montiert geliefert',
      'META CLIP S3': 'Zerlegter S3-Rahmen, ohne Werkzeug zusammengesteckt'
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

  function formatMm(mm) {
    return new Intl.NumberFormat('de-DE').format(Math.round(mm)) + ' mm';
  }

  function formatPrice(value) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
  }

  function surfaceLabel(surface) {
    return TEXT.surface[surface] || surface;
  }

  function decodeCatalog(raw) {
    if (!raw || raw.v !== 1 || !Array.isArray(raw.items)) return [];
    return raw.items.map(function (r) {
      var role = raw.roles[r[2]] || '';
      return {
        id: r[0],
        system: raw.systems[r[1]],
        role: role,
        double: role.indexOf('Doppel-') === 0,
        base: /Grundregal$/.test(role),
        h: r[3],
        b: r[4],
        t: r[5],
        load: r[6],
        levels: raw.levels[r[7]],
        lr: r[8] === 1,
        surface: raw.surfaces[r[9]]
      };
    });
  }

  function rowLength(widths) {
    var sum = widths.reduce(function (n, w) { return n + w; }, 0);
    return sum + (widths.length + 1) * CONFIG.postMm;
  }

  // Größte Feldzahl mit gleicher Breite, die in die Länge passt (0, wenn nicht einmal ein Feld passt).
  function fieldCount(length, width) {
    var n = Math.floor((length - CONFIG.postMm) / (width + CONFIG.postMm));
    return Math.max(0, Math.min(CONFIG.maxFields, n));
  }

  function sortNumbers(values) {
    return values.filter(function (v, i) { return values.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
  }

  // Auswahlwerte je Bauform aus der Tabelle.
  function choices(items, double) {
    var list = items.filter(function (i) { return i.double === !!double; });
    var pick = function (key) { return list.map(function (i) { return i[key]; }); };
    var surfaces = pick('surface').filter(function (v, i, a) { return a.indexOf(v) === i; });
    surfaces.sort(function (a, b) { return (a === 'verzinkt' ? 0 : 1) - (b === 'verzinkt' ? 0 : 1) || a.localeCompare(b); });
    return { h: sortNumbers(pick('h')), b: sortNumbers(pick('b')), t: sortNumbers(pick('t')), load: sortNumbers(pick('load')), surface: surfaces };
  }

  function lineKey(i) {
    return [i.system, i.lr ? 'lr' : 'd', i.levels, i.load].join('|');
  }

  // Ausführungen (System, Verstrebung, Ebenen, Fachlast), in denen es Grund- und Anbauregal in der Breite gibt.
  function findLines(items, q) {
    var groups = {};
    items.forEach(function (i) {
      if (i.double !== !!q.double || i.h !== q.h || i.t !== q.t || i.surface !== q.surface || i.load < q.load) return;
      var key = lineKey(i);
      var g = groups[key] || (groups[key] = { key: key, system: i.system, lr: i.lr, levels: i.levels, load: i.load, base: {}, add: {} });
      (i.base ? g.base : g.add)[i.b] = i;
    });
    // Höhere Fachlast nur als Ersatz: je System, Verstrebung und Ebenen die kleinste passende.
    var lowest = {};
    var lines = Object.keys(groups).map(function (k) { return groups[k]; })
      .filter(function (g) { return g.base[q.b] && g.add[q.b]; });
    lines.forEach(function (g) {
      var variant = [g.system, g.lr, g.levels].join('|');
      if (lowest[variant] == null || g.load < lowest[variant]) lowest[variant] = g.load;
    });
    return lines
      .filter(function (g) { return g.load === lowest[[g.system, g.lr, g.levels].join('|')]; })
      .map(function (g) {
        return { key: g.key, system: g.system, lr: g.lr, levels: g.levels, load: g.load, base: g.base[q.b], add: g.add[q.b], adds: g.add };
      })
      .sort(function (a, b) {
        return (a.load - b.load) || ((a.lr ? 1 : 0) - (b.lr ? 1 : 0)) || a.system.localeCompare(b.system) || b.levels.localeCompare(a.levels);
      });
  }

  // Anbauregale anderer Breiten für gemischte Zeilen: gleiches System, gleiche Verstrebung, Höhe, Tiefe und
  // Farbe, Fachlast mindestens wie gewünscht (gleiche Fachlast, dann gleiche Ebenen bevorzugt).
  function mixAdds(items, line, q) {
    var best = {};
    items.forEach(function (i) {
      if (i.base || i.double !== !!q.double || i.system !== line.system || i.lr !== line.lr) return;
      if (i.h !== q.h || i.t !== q.t || i.surface !== q.surface || i.load < q.load || i.b === q.b) return;
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
  function bestMix(length, baseWidth, addWidths) {
    var widths = addWidths.slice().sort(function (a, b) { return b - a; });
    var step = function (w) { return w + CONFIG.postMm; };
    var room = length - (baseWidth + 2 * CONFIG.postMm);
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
    if (!widths.length) return { widths: [baseWidth], length: rowLength([baseWidth]), counts: {} };
    walk(0, room, {}, 0);
    var all = [baseWidth];
    widths.forEach(function (w) { for (var i = 0; i < (best.counts[w] || 0); i++) all.push(w); });
    var counts = {};
    widths.forEach(function (w) { if (best.counts[w]) counts[w] = best.counts[w]; });
    return { widths: all, length: rowLength(all), counts: counts };
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
    var n = fieldCount(length, q.b);
    if (n < 1) return null;
    var counts = {};
    if (n > 1) counts[q.b] = n - 1;
    var widths = [];
    for (var i = 0; i < n; i++) widths.push(q.b);
    var sameWidth = {};
    sameWidth[q.b] = line.add;
    var main = {
      fields: n,
      length: rowLength(widths),
      nextLength: n < CONFIG.maxFields ? rowLength(widths.concat([q.b])) : null,
      widths: widths,
      positions: positionsFor(line.base, sameWidth, counts)
    };
    var adds = mixAdds(items, line, q);
    var mixWidths = Object.keys(adds).map(Number);
    var mix = null;
    if (mixWidths.length > 1) {
      var m = bestMix(length, q.b, mixWidths);
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
    var c = choices(items, q.double);
    ['b', 'h', 't', 'load', 'surface'].forEach(function (key) {
      c[key].forEach(function (v) {
        if (v === q[key]) return;
        var alt = Object.assign({}, q);
        alt[key] = v;
        if (findLines(items, alt).length) result.push({ key: key, value: v });
      });
    });
    var other = Object.assign({}, q, { double: !q.double });
    if (findLines(items, other).length) result.push({ key: 'double', value: !q.double });
    return result;
  }

  // Maße und Ausführung eines Artikels für den Link von der Produktseite.
  function parseShelfName(name) {
    var text = String(name || '').replace(/\s+/g, ' ').trim();
    if (!CONFIG.productName.test(text)) return null;
    var seg = text.split(' | ');
    var dims = text.match(/(\d+) x (\d+) x (\d+) mm/);
    var load = text.match(/Fachlast (\d+) kg/);
    if (!dims) return null;
    return {
      h: Number(dims[1]),
      b: Number(dims[2]),
      t: Number(dims[3]),
      load: load ? Number(load[1]) : null,
      surface: seg[seg.length - 1],
      double: /^Doppel-/.test(seg[2])
    };
  }

  var PARAMS = { h: 'hoehe', b: 'breite', t: 'tiefe', load: 'fachlast', surface: 'farbe', double: 'bauform', length: 'laenge' };

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
      Object.keys(PARAMS).forEach(function (key) {
        if (PARAMS[key] !== k) return;
        if (key === 'double') q.double = v === 'doppel';
        else if (key === 'surface') q.surface = v;
        else if (key === 'length') q.length = parseLength(v);
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

  // Werte der Auswahl auf vorhandene setzen (Fachlast: nächsthöhere, sonst höchste).
  function normalizeQuery(items, q) {
    var c = choices(items, q.double);
    var load = c.load.filter(function (v) { return v >= (q.load || 0); })[0];
    return {
      double: !!q.double,
      h: c.h.indexOf(q.h) >= 0 ? q.h : closest(c.h, q.h != null ? q.h : 2000),
      b: c.b.indexOf(q.b) >= 0 ? q.b : closest(c.b, q.b != null ? q.b : 1000),
      t: c.t.indexOf(q.t) >= 0 ? q.t : closest(c.t, q.t != null ? q.t : 500),
      load: load != null ? load : c.load[c.load.length - 1],
      surface: c.surface.indexOf(q.surface) >= 0 ? q.surface : c.surface[0],
      length: q.length || null
    };
  }

  var api = {
    config: CONFIG,
    parseLength: parseLength,
    decodeCatalog: decodeCatalog,
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

  function lineTitle(line) {
    return line.system + ' · ' + line.levels + ' Ebenen · Fachlast ' + line.load + ' kg';
  }

  function widthsText(widths) {
    var counts = {};
    widths.forEach(function (w) { counts[w] = (counts[w] || 0) + 1; });
    return Object.keys(counts).map(Number).sort(function (a, b) { return b - a; })
      .map(function (w) { return counts[w] + ' × ' + new Intl.NumberFormat('de-DE').format(w); }).join(' + ') + ' mm';
  }

  function renderPlan(card, plan, q) {
    var body = card.querySelector('.meta-qc__plan');
    body.innerHTML = '';
    var summary = el('p', 'meta-qc__summary');
    var strong = el('strong', null, plan.fields + (plan.fields === 1 ? ' Feld' : ' Felder') + ' · Gesamtlänge ca. ' + formatMm(plan.length));
    summary.appendChild(strong);
    summary.appendChild(document.createTextNode(' (' + widthsText(plan.widths) + ', Rest ' + formatMm(q.length - plan.length) + ')'));
    body.appendChild(summary);

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
    var h3 = el('h3', 'meta-qc__line-title', lineTitle(result.line));
    h3.id = headingId;
    head.appendChild(h3);
    card.appendChild(head);
    var facts = el('ul', 'meta-qc__facts');
    facts.appendChild(el('li', null, TEXT.frame[result.line.system] || result.line.system));
    var bracing = q.double ? (result.line.lr ? 'doubleLr' : 'doubleDiagonal') : (result.line.lr ? 'lr' : 'diagonal');
    facts.appendChild(el('li', null, TEXT.bracing[bracing]));
    if (result.line.load > q.load) facts.appendChild(el('li', 'meta-qc__hint', 'Fachlast ' + result.line.load + ' kg – mehr als gewünscht, in ' + q.load + ' kg gibt es diese Ausführung nicht'));
    card.appendChild(facts);

    var plan = el('div', 'meta-qc__plan');
    card.appendChild(plan);

    var current = result.main;
    if (result.mix) {
      var toggle = el('div', 'meta-qc__mix');
      var text = el('p', null, 'Mit gemischten Feldbreiten (' + widthsText(result.mix.widths) + ') wird die Zeile ' + formatMm(result.mix.length) + ' lang, ' + formatMm(result.mix.length - result.main.length) + ' mehr.');
      var button = el('button', 'btn btn-outline-primary btn-sm', 'Gemischte Breiten zeigen');
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', function () {
        current = current === result.main ? result.mix : result.main;
        var mixed = current === result.mix;
        button.setAttribute('aria-pressed', mixed ? 'true' : 'false');
        button.textContent = mixed ? 'Nur ' + formatMm(q.b) + ' zeigen' : 'Gemischte Breiten zeigen';
        renderPlan(card, current, q);
      });
      toggle.appendChild(text);
      toggle.appendChild(button);
      card.appendChild(toggle);
    } else if (result.main.nextLength) {
      card.appendChild(el('p', 'meta-qc__note', 'Mit einem Feld mehr wäre die Zeile ' + formatMm(result.main.nextLength) + ' lang.'));
    }
    return { card: card, ready: renderPlan(card, current, q) };
  }

  var LABEL = { h: 'Höhe', b: 'Feldbreite', t: 'Tiefe', load: 'Fachlast', surface: 'Farbe', double: 'Bauform' };

  function valueText(key, v) {
    if (key === 'surface') return surfaceLabel(v);
    if (key === 'double') return v ? 'Doppelregal' : 'Einzelregal';
    if (key === 'load') return v + ' kg';
    return formatMm(v);
  }

  function mount(root, items) {
    var q = normalizeQuery(items, readQuery(window.location.search));
    root.innerHTML = '';
    root.classList.add('meta-qc--ready');

    var form = el('form', 'meta-qc__form');
    form.setAttribute('novalidate', 'novalidate');
    form.addEventListener('submit', function (e) { e.preventDefault(); update(); });

    var fields = {};
    function field(key, label, control, hint) {
      var wrap = el('div', 'meta-qc__field meta-qc__field--' + key);
      var id = 'meta-qc-' + key;
      var lab = el('label', 'meta-qc__label', label);
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

    var bauform = el('select', 'form-select');
    [['einzel', 'Einzelregal'], ['doppel', 'Doppelregal']].forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = o[0];
      bauform.appendChild(opt);
    });
    field('double', 'Bauform', bauform);
    ['h', 'b', 't', 'load', 'surface'].forEach(function (key) { field(key, LABEL[key], el('select', 'form-select')); });
    var lengthInput = el('input', 'form-control');
    lengthInput.type = 'text';
    lengthInput.inputMode = 'decimal';
    lengthInput.autocomplete = 'off';
    lengthInput.placeholder = 'z. B. 5000';
    field('length', 'Verfügbare Länge in mm', lengthInput, 'Die Regalzeile wird so lang wie möglich, aber nie länger.');
    root.appendChild(form);

    var status = el('p', 'meta-qc__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    root.appendChild(status);
    var results = el('div', 'meta-qc__results');
    root.appendChild(results);

    function fillSelect(key) {
      var select = fields[key];
      var values = choices(items, q.double)[key];
      select.innerHTML = '';
      values.forEach(function (v) {
        var opt = el('option', null, valueText(key, v));
        opt.value = String(v);
        select.appendChild(opt);
      });
      select.value = String(q[key]);
    }

    function syncForm() {
      bauform.value = q.double ? 'doppel' : 'einzel';
      ['h', 'b', 't', 'load', 'surface'].forEach(fillSelect);
      if (q.length && document.activeElement !== lengthInput) lengthInput.value = String(q.length);
    }

    function readForm() {
      var next = {
        double: bauform.value === 'doppel',
        h: Number(fields.h.value),
        b: Number(fields.b.value),
        t: Number(fields.t.value),
        load: Number(fields.load.value),
        surface: fields.surface.value,
        length: parseLength(lengthInput.value)
      };
      if (next.double !== q.double) next = normalizeQuery(items, next);
      q = next;
    }

    function setQuery(change) {
      q = normalizeQuery(items, Object.assign({}, q, change));
      syncForm();
      update();
    }

    function update() {
      results.innerHTML = '';
      try { window.history.replaceState(null, '', window.location.pathname + toQuery(q)); } catch (e) { /* still */ }
      var lines = findLines(items, q);
      if (!lines.length) {
        status.textContent = 'Diese Kombination gibt es nicht als Standardregal.';
        var alts = alternatives(items, q);
        if (alts.length) {
          var box = el('div', 'meta-qc__alts');
          box.appendChild(el('p', null, 'Verfügbar mit:'));
          var list = el('ul', 'meta-qc__chips');
          alts.forEach(function (a) {
            var li = el('li');
            var b = el('button', 'meta-qc__chip', LABEL[a.key] + ' ' + valueText(a.key, a.value));
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
      if (!q.length) {
        status.textContent = 'Bitte die verfügbare Länge eingeben.';
        return;
      }
      var single = rowLength([q.b]);
      if (q.length < single) {
        status.textContent = 'Ein Grundregal mit ' + formatMm(q.b) + ' Feldbreite ist ' + formatMm(single) + ' lang, also länger als ' + formatMm(q.length) + '.';
        return;
      }
      var planned = lines.slice(0, CONFIG.maxLines).map(function (line) { return planLine(items, line, q, q.length); }).filter(Boolean);
      var first = planned[0];
      status.textContent = 'Für ' + formatMm(q.length) + ': ' + first.main.fields + (first.main.fields === 1 ? ' Feld' : ' Felder') +
        ' mit ' + formatMm(q.b) + ' Feldbreite, Gesamtlänge ca. ' + formatMm(first.main.length) + '. ' +
        (planned.length > 1 ? planned.length + ' Ausführungen zur Auswahl.' : '');
      if (!q.double && q.h / q.t > 4) {
        results.appendChild(el('p', 'meta-qc__warning', 'Höhe zu Tiefe über 4 : 1 – laut META-Katalog das Regal mit Wand- oder Fußverankerung gegen Kippen sichern.'));
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
      results.appendChild(el('p', 'meta-qc__footnote', 'Gesamtlänge gerechnet mit ' + CONFIG.postMm + ' mm je Ständerrahmen. Zubehör wie Rückwände, Fachteiler oder Zusatzböden finden Sie auf den Produktseiten unter „Das passt dazu".'));
    }

    form.addEventListener('change', function (e) {
      readForm();
      if (e.target === bauform) syncForm();
      update();
    });
    var typing = null;
    lengthInput.addEventListener('input', function () {
      clearTimeout(typing);
      typing = setTimeout(function () { readForm(); update(); }, 400);
    });

    syncForm();
    update();
  }

  function startPage() {
    var root = document.querySelector('[data-meta-quick-config]');
    if (!root || root.classList.contains('meta-qc--ready')) return;
    var src = root.getAttribute('data-catalog');
    var fail = function () {
      root.innerHTML = '';
      root.appendChild(el('p', 'meta-qc__error', 'Der Schnellkonfigurator ist gerade nicht verfügbar. Alle Fachbodenregale finden Sie unter Fachbodenregale.'));
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

  // ---------- Einstiegskasten und Produktseite ----------

  function startTeaser() {
    if (CONFIG.teaserPaths.indexOf(path) === -1 || document.querySelector('.meta-qc-teaser')) return;
    var box = el('aside', 'meta-qc-teaser');
    box.setAttribute('aria-label', 'Regal-Schnellkonfigurator');
    var text = el('div', 'meta-qc-teaser__text');
    text.appendChild(el('p', 'meta-qc-teaser__title', 'Regalzeile in einer Minute berechnen'));
    text.appendChild(el('p', 'meta-qc-teaser__body', 'Höhe, Feldbreite, Tiefe, Fachlast und verfügbare Länge eingeben – der Schnellkonfigurator stellt Grund- und Anbauregale zusammen und legt sie in den Warenkorb.'));
    box.appendChild(text);
    var link = el('a', 'btn btn-primary meta-qc-teaser__link', 'Zum Schnellkonfigurator');
    link.href = CONFIG.pagePath;
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
    startProduct();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return api;
})();
