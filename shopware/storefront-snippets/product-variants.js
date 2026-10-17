/*
 * METAorder: „Auch erhältlich in" auf der Produktseite – dasselbe Regal in anderer Höhe, Tiefe oder
 * Farbe als Auswahl über den Vorteilen („Ihre Vorteile auf einen Blick") in der Kaufbox.
 *
 * Quelle: shopware/storefront-snippets/product-variants.js im METAorder-Repo.
 * Eingespielt über das Plugin „Eigenes CSS/JS" (DneCustomCssJs) per
 * scripts/writeProductVariants.ts. Änderungen im Shop-Admin überschreibt der nächste Lauf.
 *
 * Daten: Crossselling-Reiter „Auch erhältlich in", den METAorder aus den festen Namensregeln
 * pflegt (je Höhe, Tiefe und Farbe ein Artikel, der sich nur darin unterscheidet). Das Skript
 * liest den Reiter aus der Seite, vergleicht die Artikelnamen („SYSTEM | Art | Rolle | H x B x T mm |
 * Fachlast … | … | Oberfläche") mit dem angezeigten Artikel und blendet den Reiter unten aus.
 * Passt nichts, bleibt alles wie es ist.
 */
var MetaProductVariants = (function () {
  'use strict';

  var CONFIG = {
    version: '1',
    // Nur der Onlineshop „META Regalbau DE" (gleiche ID im Testshop und im Live-Shop).
    salesChannelIds: ['018ec134507f703b82a76467791e7e61'],
    // Crossselling-Reiter mit den Ausführungen (Kleinschreibung).
    tabTitles: ['auch erhältlich in'],
    heading: 'Auch erhältlich in',
    groups: [
      { key: 'height', label: 'Höhe' },
      { key: 'depth', label: 'Tiefe' },
      { key: 'surface', label: 'Farbe' }
    ],
    // RAL-Farbnamen und Musterfarben für die Farbpunkte
    ral: {
      '1023': ['verkehrsgelb', '#f0ca00'],
      '2001': ['rotorange', '#c35b24'],
      '3000': ['feuerrot', '#a72920'],
      '5010': ['enzianblau', '#1d4e89'],
      '5012': ['lichtblau', '#3b83bd'],
      '6011': ['resedagrün', '#587f40'],
      '7016': ['anthrazitgrau', '#383e42'],
      '7035': ['lichtgrau', '#cbd0cc'],
      '9005': ['tiefschwarz', '#0a0a0a'],
      '9006': ['weißaluminium', '#a1a1a0'],
      '9010': ['reinweiß', '#f1ece1']
    },
    zinc: '#b9bec2'
  };

  var DIM_RE = /^(\d[\d.,]*)\s*x\s*(\d[\d.,]*)\s*x\s*(\d[\d.,]*)\s*mm$/i;
  var LOAD_RE = /^(?:Fachlast|Armlast|Feldlast)?\s*\d[\d.,]*\s*kg$/i;
  var SURFACE_RE = /^(verzinkt|feuerverzinkt|RAL \d{4}(?:\/[\w ]+)?|verzinkt\/RAL \d{4})$/i;

  function normalize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function toNumber(raw) {
    return Number(String(raw).replace(/\./g, '').replace(',', '.'));
  }

  // Name nach META-Namensschema zerlegen; null, wenn kein Regal mit drei Maßen.
  function parseName(name) {
    var segments = String(name || '').replace(/\s+/g, ' ').trim().split(' | ');
    if (segments.length < 4) return null;
    var dims = null;
    var load = null;
    var surface = null;
    var rest = [];
    segments.forEach(function (seg, i) {
      var m = seg.match(DIM_RE);
      if (m && !dims) {
        dims = [toNumber(m[1]), toNumber(m[2]), toNumber(m[3])];
      } else if (i > 1 && LOAD_RE.test(seg) && !load) {
        load = seg;
      } else if (i > 1 && SURFACE_RE.test(seg)) {
        surface = seg;
      } else if (!/^\d+(\+\d+)?\s+(Ebenen|Paletten)$/i.test(seg) && !/^\d+\s+Felder$/i.test(seg)) {
        rest.push(seg);
      }
    });
    if (!dims) return null;
    return { dims: dims, load: load, surface: surface, key: rest.join(' | ') + ' | ' + dims[1] };
  }

  function surfaceInfo(surface) {
    var text = String(surface || '');
    var ral = text.match(/RAL (\d{4})/i);
    var zinc = /verzinkt/i.test(text);
    var known = ral ? CONFIG.ral[ral[1]] : null;
    var label;
    if (ral && zinc) label = 'verzinkt / RAL ' + ral[1] + (known ? ' ' + known[0] : '');
    else if (ral) label = 'RAL ' + ral[1] + (known ? ' ' + known[0] : '');
    else label = text.toLowerCase();
    label = label.charAt(0).toUpperCase() + label.slice(1);
    var colors = [];
    if (zinc) colors.push(CONFIG.zinc);
    if (ral) colors.push(known ? known[1] : null);
    return { label: label, colors: colors.filter(Boolean), sort: (zinc && !ral ? 0 : 1) * 10000 + (ral ? Number(ral[1]) : 0) };
  }

  // Worin unterscheidet sich die Ausführung vom angezeigten Artikel? Genau ein Merkmal, sonst null.
  function classify(current, other) {
    if (!current || !other || current.key !== other.key) return null;
    var diffs = [];
    if (current.dims[0] !== other.dims[0]) diffs.push('height');
    if (current.dims[2] !== other.dims[2]) diffs.push('depth');
    if (normalize(current.surface) !== normalize(other.surface)) diffs.push('surface');
    if (diffs.length !== 1) return null;
    if (diffs[0] === 'surface' && !other.surface) return null;
    return diffs[0];
  }

  function option(kind, parsed) {
    if (kind === 'height') return { label: parsed.dims[0] + ' mm', sort: parsed.dims[0] };
    if (kind === 'depth') return { label: parsed.dims[2] + ' mm', sort: parsed.dims[2] };
    var info = surfaceInfo(parsed.surface);
    return { label: info.label, sort: info.sort, colors: info.colors };
  }

  // Gruppen Höhe/Tiefe/Farbe mit dem angezeigten Wert (current) und den Ausführungen.
  function buildGroups(currentName, items) {
    var current = parseName(currentName);
    if (!current) return [];
    var groups = {};
    CONFIG.groups.forEach(function (g) { groups[g.key] = []; });
    (items || []).forEach(function (item) {
      var parsed = parseName(item.name);
      var kind = classify(current, parsed);
      if (!kind) return;
      var opt = option(kind, parsed);
      if (groups[kind].some(function (o) { return o.label === opt.label; })) return;
      opt.href = item.href;
      opt.name = item.name;
      if (parsed.load && current.load && normalize(parsed.load) !== normalize(current.load)) opt.note = parsed.load;
      groups[kind].push(opt);
    });
    return CONFIG.groups
      .filter(function (g) { return groups[g.key].length > 0 && (g.key !== 'surface' || current.surface); })
      .map(function (g) {
        var own = option(g.key, current);
        own.current = true;
        var options = groups[g.key].concat([own]).sort(function (a, b) {
          return a.sort - b.sort || (a.label < b.label ? -1 : 1);
        });
        return { key: g.key, label: g.label, options: options };
      });
  }

  var api = { config: CONFIG, parseName: parseName, classify: classify, buildGroups: buildGroups, surfaceInfo: surfaceInfo, normalize: normalize };
  if (typeof window === 'undefined' || typeof document === 'undefined') return api;
  if (CONFIG.salesChannelIds.indexOf(window.salesChannelId) === -1) return api;

  function findTab() {
    var links = document.querySelectorAll('#product-detail-cross-selling-tabs a[href^="#cross-selling-tab-"], #product-detail-cross-selling-tabs [data-bs-target^="#cross-selling-tab-"]');
    for (var i = 0; i < links.length; i++) {
      if (CONFIG.tabTitles.indexOf(normalize(links[i].textContent)) === -1) continue;
      var target = links[i].getAttribute('data-bs-target') || links[i].getAttribute('href');
      var pane = document.getElementById(target.slice(1));
      if (pane) return { link: links[i], pane: pane };
    }
    return null;
  }

  function readItems(pane) {
    var items = [];
    pane.querySelectorAll('.product-box').forEach(function (box) {
      var info = {};
      try { info = JSON.parse(box.getAttribute('data-product-information') || '{}'); } catch (e) { /* Name aus dem Link */ }
      var link = box.querySelector('a.product-name');
      if (!link) return;
      items.push({ name: info.name || link.getAttribute('title') || link.textContent, href: link.href });
    });
    return items;
  }

  function render(groups) {
    var section = document.createElement('section');
    section.className = 'meta-variants';
    section.setAttribute('aria-labelledby', 'meta-variants-heading');
    section.setAttribute('data-meta-variants-version', CONFIG.version);

    var heading = document.createElement('h2');
    heading.className = 'meta-variants__heading';
    heading.id = 'meta-variants-heading';
    heading.textContent = CONFIG.heading;
    section.appendChild(heading);

    groups.forEach(function (group) {
      var row = document.createElement('div');
      row.className = 'meta-variants__group meta-variants__group--' + group.key;
      row.setAttribute('role', 'group');
      row.setAttribute('aria-labelledby', 'meta-variants-' + group.key);

      var label = document.createElement('span');
      label.className = 'meta-variants__label';
      label.id = 'meta-variants-' + group.key;
      label.textContent = group.label;
      row.appendChild(label);

      var list = document.createElement('ul');
      list.className = 'meta-variants__options';
      group.options.forEach(function (opt) {
        var li = document.createElement('li');
        var el = document.createElement(opt.current ? 'span' : 'a');
        el.className = 'meta-variants__option' + (opt.current ? ' is-current' : '');
        if (opt.current) {
          el.setAttribute('aria-current', 'true');
        } else {
          el.href = opt.href;
          el.title = opt.name;
        }
        if (opt.colors && opt.colors.length) {
          var dot = document.createElement('span');
          dot.className = 'meta-variants__swatch';
          dot.setAttribute('aria-hidden', 'true');
          dot.style.background = opt.colors.length > 1
            ? 'linear-gradient(135deg, ' + opt.colors[0] + ' 50%, ' + opt.colors[1] + ' 50%)'
            : opt.colors[0];
          el.appendChild(dot);
        }
        var text = document.createElement('span');
        text.className = 'meta-variants__value';
        text.textContent = opt.label;
        el.appendChild(text);
        if (opt.note) {
          var note = document.createElement('span');
          note.className = 'meta-variants__note';
          note.textContent = opt.note;
          el.appendChild(note);
        }
        li.appendChild(el);
        list.appendChild(li);
      });
      row.appendChild(list);
      section.appendChild(row);
    });
    return section;
  }

  function insert(section) {
    var buy = document.querySelector('.product-detail-buy');
    if (!buy) return false;
    var anchor = buy.querySelector('.buybox-highlights');
    if (anchor) {
      anchor.parentNode.insertBefore(section, anchor);
      return true;
    }
    anchor = buy.querySelector('.product-detail-ordernumbers-container') || buy.querySelector('.product-detail-form-container');
    if (!anchor) return false;
    anchor.insertAdjacentElement('afterend', section);
    return true;
  }

  // Reiter unten entfernen; war er aktiv, den ersten übrigen zeigen; ohne Reiter den Bereich ausblenden.
  function hideTab(tab) {
    var wasActive = tab.link.classList.contains('active');
    var item = tab.link.closest('li') || tab.link;
    var nav = item.parentNode;
    item.parentNode.removeChild(item);
    tab.pane.parentNode.removeChild(tab.pane);
    var next = nav.querySelector('a[href^="#cross-selling-tab-"], [data-bs-target^="#cross-selling-tab-"]');
    if (!next) {
      var area = nav.closest('.product-detail-cross-selling') || nav.closest('.cms-element-cross-selling');
      if (area) area.style.display = 'none';
      return;
    }
    if (!wasActive) return;
    next.classList.add('active');
    next.setAttribute('aria-selected', 'true');
    var pane = document.getElementById((next.getAttribute('data-bs-target') || next.getAttribute('href')).slice(1));
    if (pane) pane.classList.add('active', 'show');
  }

  function start() {
    if (document.querySelector('.meta-variants')) return;
    var title = document.querySelector('.product-detail-buy .product-detail-name, h1.product-detail-name');
    var tab = findTab();
    if (!title || !tab) return;
    var groups = buildGroups(title.textContent, readItems(tab.pane));
    if (!groups.length) return;
    if (!insert(render(groups))) return;
    hideTab(tab);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return api;
})();
