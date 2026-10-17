/*
 * METAorder: Erklär-Hinweise aus dem Regal-Lexikon – ein kleines „i“ hinter Fachbegriffen auf Produkt- und
 * Kategorieseiten. Ein Klick öffnet einen Kasten mit dem ersten Satz der Erklärung und dem Link ins Lexikon
 * (/regal-lexikon#schluessel).
 *
 * Quelle: shopware/storefront-snippets/glossary-hints.js im METAorder-Repo.
 * Eingespielt über das Plugin „Eigenes CSS/JS" (DneCustomCssJs) per scripts/writeGlossaryHints.ts.
 * Änderungen im Shop-Admin überschreibt der nächste Lauf.
 *
 * Daten: Begriffe mit `hint: true` aus server/products/glossary.ts. Das Einspielskript setzt sie zwischen die
 * Markierungen METAORDER_GLOSSARY_HINTS und END ein; im Repo steht dort eine leere Liste.
 *
 * Wo: nur Artikelname (Grundregal, Anbauregal, Komplettregal, S3), Eigenschaften-Tabelle (Namen und Werte)
 * und Filtertitel. Kein Fließtext. Je Begriff und Seite nur das erste Vorkommen.
 */
var MetaGlossaryHints = (function () {
  'use strict';

  var DATA = /*METAORDER_GLOSSARY_HINTS*/{ "url": "/regal-lexikon", "terms": [] }/*END*/;

  var CONFIG = {
    version: '1',
    // Nur der Onlineshop „META Regalbau DE" (gleiche ID im Testshop und im Live-Shop).
    salesChannelIds: ['018ec134507f703b82a76467791e7e61'],
    // place: inline = direkt hinter dem Wort, end = ans Ende der Zelle, after = neben den Filter-Knopf
    sources: [
      { selector: 'h1.product-detail-name', place: 'inline', keys: ['grundregal', 'anbauregal', 'komplettregal', 's3-rahmen'] },
      { selector: '.product-detail-properties-table th.properties-label', place: 'end' },
      { selector: '.product-detail-properties-table td.properties-value', place: 'end' },
      { selector: '.filter-panel-item > .filter-panel-item-toggle', place: 'after' }
    ],
    // Bis zu dieser Breite (und in Offcanvas-Bereichen) erscheint der Kasten unter der Zeile statt als Tooltip.
    inlineMaxWidth: 575.98,
    moreLabel: 'Mehr im Regal-Lexikon ›'
  };

  // Wortgrenze: kein Buchstabe, keine Ziffer, kein Bindestrich davor oder danach
  // („Reifen-Längsriegel" ist kein Längsriegel). Plural-Endungen sind erlaubt („Feldlasten").
  var WORD = 'a-z0-9äöüß\\-';

  function escapeRe(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function compile(terms) {
    var list = [];
    (terms || []).forEach(function (t) {
      [t.term].concat(t.aliases || []).forEach(function (variant) {
        var body = escapeRe(String(variant).trim()).replace(/\s+/g, '\\s*');
        if (!body) return;
        list.push({
          key: t.key,
          length: variant.length,
          re: new RegExp('(^|[^' + WORD + '])(' + body + ')(?:e|en|n|s|es)?(?=$|[^' + WORD + '])', 'i')
        });
      });
    });
    return list;
  }

  // Erster Begriff im Text (frühestes Vorkommen, bei Gleichstand die längere Schreibweise).
  // keys: nur diese Begriffe; used: schon vergebene Begriffe überspringen.
  function findTerm(text, compiled, keys, used) {
    var best = null;
    (compiled || []).forEach(function (c) {
      if (keys && keys.indexOf(c.key) === -1) return;
      if (used && used[c.key]) return;
      var m = c.re.exec(String(text || ''));
      if (!m) return;
      var index = m.index + m[1].length;
      if (!best || index < best.index || (index === best.index && c.length > best.length)) {
        best = { key: c.key, index: index, end: m.index + m[0].length, length: c.length };
      }
    });
    return best && { key: best.key, index: best.index, end: best.end };
  }

  var api = { config: CONFIG, data: DATA, compile: compile, findTerm: findTerm };
  if (typeof window === 'undefined' || typeof document === 'undefined') return api;
  if (CONFIG.salesChannelIds.indexOf(window.salesChannelId) === -1) return api;
  if (!DATA.terms.length || window.MetaGlossaryHintsStarted) return api;
  window.MetaGlossaryHintsStarted = true;

  var byKey = {};
  DATA.terms.forEach(function (t) { byKey[t.key] = t; });
  var current = null;

  function makeButton(term) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'meta-gh-btn';
    btn.setAttribute('data-meta-gh', term.key);
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Was bedeutet „' + term.term + '“?');
    return btn;
  }

  // Wort und „i“ in einen nicht umbrechenden Bereich; der Text der Überschrift bzw. Zelle bleibt gleich.
  function wrapWithButton(node, from, to, btn) {
    var word = node.splitText(from);
    word.splitText(to - from);
    var wrap = document.createElement('span');
    wrap.className = 'meta-gh-term';
    word.parentNode.insertBefore(wrap, word);
    wrap.appendChild(word);
    wrap.appendChild(btn);
    return true;
  }

  // Direkt hinter dem gefundenen Wort (Artikelname)
  function placeInline(el, hit, btn) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var offset = 0;
    var node;
    while ((node = walker.nextNode())) {
      var len = node.nodeValue.length;
      if (hit.index >= offset && hit.end <= offset + len) return wrapWithButton(node, hit.index - offset, hit.end - offset, btn);
      offset += len;
    }
    return false;
  }

  // Hinter dem letzten Wort der Zelle („max. Fachlast: i“)
  function placeEnd(el, btn) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var last = null;
    var node;
    while ((node = walker.nextNode())) {
      if (/\S/.test(node.nodeValue)) last = node;
    }
    if (!last) {
      el.appendChild(btn);
      return true;
    }
    var text = last.nodeValue.replace(/\s+$/, '');
    return wrapWithButton(last, text.search(/\S+$/), text.length, btn);
  }

  function place(el, how, hit, btn) {
    if (how === 'inline') return placeInline(el, hit, btn);
    if (how === 'after') {
      el.insertAdjacentElement('afterend', btn);
      el.parentNode.classList.add('meta-gh-filter');
      return true;
    }
    return placeEnd(el, btn);
  }

  function start() {
    var compiled = compile(DATA.terms);
    var used = {};
    var selector = CONFIG.sources.map(function (s) { return s.selector; }).join(',');
    document.querySelectorAll(selector).forEach(function (el) {
      if (el.querySelector('.meta-gh-btn') || (el.nextElementSibling && el.nextElementSibling.classList.contains('meta-gh-btn'))) return;
      var source = null;
      CONFIG.sources.forEach(function (s) { if (!source && el.matches(s.selector)) source = s; });
      // Im Artikelnamen alle passenden Teile (S3 und Grundregal), sonst ein Begriff je Zelle bzw. Filter
      var hit;
      while ((hit = findTerm(el.textContent, compiled, source.keys, used))) {
        if (!place(el, source.place, hit, makeButton(byKey[hit.key]))) break;
        used[hit.key] = true;
        if (source.place !== 'inline') break;
      }
    });
  }

  function useInline(btn) {
    return window.innerWidth <= CONFIG.inlineMaxWidth || !!btn.closest('.offcanvas');
  }

  // „Zeile", unter der der Kasten am Handy erscheint
  function lineOf(btn) {
    return btn.closest('tr') || btn.closest('.filter-panel-item') || btn.closest('h1') || btn.parentNode;
  }

  function buildBox(term) {
    var box = document.createElement('div');
    box.className = 'meta-gh-box';
    box.id = 'meta-gh-box';
    box.setAttribute('data-meta-gh-version', CONFIG.version);

    var title = document.createElement('p');
    title.className = 'meta-gh-box__term';
    title.textContent = term.term;
    box.appendChild(title);

    var text = document.createElement('p');
    text.className = 'meta-gh-box__text';
    text.textContent = term.text;
    box.appendChild(text);

    var more = document.createElement('a');
    more.className = 'meta-gh-box__more';
    more.href = DATA.url + '#' + encodeURIComponent(term.key);
    more.textContent = CONFIG.moreLabel;
    box.appendChild(more);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'meta-gh-box__close';
    closeBtn.setAttribute('aria-label', 'Erklärung schließen');
    box.appendChild(closeBtn);
    return box;
  }

  function openFor(btn) {
    var term = byKey[btn.getAttribute('data-meta-gh')];
    if (!term) return;
    close(false);
    var box = buildBox(term);
    var row = null;
    var inline = useInline(btn);
    if (inline) {
      box.classList.add('is-inline');
      var line = lineOf(btn);
      if (line.tagName === 'TR') {
        row = document.createElement('tr');
        row.className = 'meta-gh-row';
        var cell = document.createElement('td');
        cell.colSpan = line.children.length || 2;
        cell.appendChild(box);
        row.appendChild(cell);
        line.insertAdjacentElement('afterend', row);
      } else {
        line.insertAdjacentElement('afterend', box);
      }
    } else {
      document.body.appendChild(box);
      var rect = btn.getBoundingClientRect();
      var scrollX = window.pageXOffset;
      var maxLeft = scrollX + document.documentElement.clientWidth - box.offsetWidth - 12;
      box.style.left = Math.max(scrollX + 12, Math.min(rect.left + scrollX - 16, maxLeft)) + 'px';
      box.style.top = (rect.bottom + window.pageYOffset + 8) + 'px';
    }
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', box.id);
    btn.classList.add('is-open');
    current = { btn: btn, box: box, row: row, inline: inline };
  }

  function close(focusButton) {
    if (!current) return;
    var btn = current.btn;
    (current.row || current.box).remove();
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-controls');
    btn.classList.remove('is-open');
    current = null;
    if (focusButton) btn.focus();
  }

  function focusables(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetWidth > 0 || el.offsetHeight > 0; }
    );
  }

  // Der Tooltip hängt am Seitenende; die Tab-Reihenfolge führt trotzdem vom „i“ in den Kasten und weiter.
  function onTab(e) {
    if (!current || current.inline) return;
    var inBox = focusables(current.box);
    var active = document.activeElement;
    if (active === current.btn && !e.shiftKey) {
      e.preventDefault();
      inBox[0].focus();
    } else if (active === inBox[0] && e.shiftKey) {
      e.preventDefault();
      current.btn.focus();
    } else if (active === inBox[inBox.length - 1] && !e.shiftKey) {
      e.preventDefault();
      var btn = current.btn;
      var page = focusables(document).filter(function (el) { return !current.box.contains(el); });
      close(false);
      (page[page.indexOf(btn) + 1] || btn).focus();
    }
  }

  // Capture-Phase: Shop-Skripte, die Klicks abfangen (Offcanvas, Filter), halten den Hinweis nicht auf.
  document.addEventListener('click', function (e) {
    var target = e.target;
    var btn = target.closest && target.closest('.meta-gh-btn');
    if (btn) {
      e.preventDefault();
      if (current && current.btn === btn) close(false);
      else openFor(btn);
      return;
    }
    if (!current) return;
    if (target.closest && target.closest('.meta-gh-box__close')) close(true);
    else if (!current.box.contains(target)) close(false);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (!current) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      var focusButton = current.box.contains(document.activeElement) || document.activeElement === current.btn;
      close(focusButton);
    } else if (e.key === 'Tab') {
      onTab(e);
    }
  });

  window.addEventListener('resize', function () {
    if (current && !current.inline) close(false);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return api;
})();
