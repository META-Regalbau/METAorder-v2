/*
 * METAorder: Anpassungen der Suchergebnisseite.
 *
 * Quelle: shopware/storefront-snippets/search-page.js im METAorder-Repo.
 * Eingespielt über das Plugin „Eigenes CSS/JS" (DneCustomCssJs) per
 * scripts/writeSearchPage.ts. Änderungen im Shop-Admin überschreibt der nächste Lauf.
 *
 * 1. Hinweis über den Treffern: Passt der Suchbegriff zu einem Regalsystem oder einer Branche,
 *    steht über den Treffern ein Kasten mit der Themenseite und den wichtigsten Kategorien.
 * 2. Filter kürzen: Bei mehr als maxVisibleFilters Filtern bleiben am Desktop nur die
 *    Hauptfilter und alle Filter mit Auswahl sichtbar, der Rest liegt hinter „Weitere Filter".
 *    Am Handy (Filter im Seitenmenü) bleibt alles sichtbar.
 * 3. Leere Treffer: Suchtipps, die Regalsysteme und der Kontakt zur Beratung.
 */
var MetaSearchPage = (function () {
  'use strict';

  var CONFIG = {
    version: '1',
    // Nur der Onlineshop „META Regalbau DE" (gleiche ID im Testshop und im Live-Shop).
    salesChannelIds: ['018ec134507f703b82a76467791e7e61'],
    maxVisibleFilters: 10,
    minPrimaryFilters: 4,
    fillUpFilters: 8,
    // Hauptfilter in Shop-Schreibweise; die Reihenfolge im Shop bleibt.
    primaryFilters: ['Regal-Typ', 'Regal-System', 'Höhe', 'Breite', 'Tiefe', 'Regaltiefe', 'Fachlast', 'Preis'],
    // Suchbegriffe in normalisierter Form (klein, ä → ae, Satzzeichen → Leerzeichen).
    // Der Begriff, der im Suchtext am weitesten vorne steht, gewinnt.
    topics: [
      {
        keys: ['reifen', 'felge', 'raeder', 'kfz', 'autohaus'],
        title: 'Regale für Kfz-Werkstatt, Autohaus und Reifenhandel',
        href: '/branchen/kfz-werkstatt-reifenhandel',
        links: []
      },
      {
        keys: ['kabeltrommel'],
        title: 'Regale für Handwerk und Werkstatt',
        href: '/branchen/handwerk-werkstatt',
        links: []
      },
      {
        keys: ['buero', 'ordner', 'akten', 'archiv', 'compact'],
        title: 'Alles zu META Büroregalen',
        href: '/bueroregale',
        links: [
          { label: 'META COMPACT Grundregale', href: '/compact-grundregale' },
          { label: 'META COMPACT Anbauregale', href: '/compact-anbauregale' },
          { label: 'Regale für Büro, Archiv und Verwaltung', href: '/branchen/buero-archiv-verwaltung' }
        ]
      },
      {
        keys: ['fachboden', 'clip'],
        title: 'Alles zu META Fachbodenregalen',
        href: '/fachbodenregale/',
        links: [
          { label: 'META CLIP Grundregale', href: '/clip-grundregale' },
          { label: 'META CLIP Anbauregale', href: '/clip-anbauregale' },
          { label: 'CLIP Böden und Auflagen', href: '/clip-boeden-und-auflagen' },
          { label: 'META CLIP Zubehör', href: '/clip-zubehoer' }
        ]
      },
      {
        keys: ['palette', 'multipal'],
        title: 'Alles zum META Palettenregal',
        href: '/palettenregale/',
        links: [
          { label: 'META MULTIPAL Grundregale', href: '/multipal-grundregale' },
          { label: 'META MULTIPAL Anbauregale', href: '/multipal-anbauregale' },
          { label: 'META MULTIPAL Komplettregale', href: '/multipal-komplettregale' },
          { label: 'MULTIPAL Zubehör', href: '/multipal-zubehoer' }
        ]
      },
      {
        keys: ['kragarm', 'langgut', 'multistrong', 'atlas'],
        title: 'Alles zu META Kragarmregalen',
        href: '/kragarmregale/',
        links: [
          { label: 'META ATLAS ST Komplettregale', href: '/atlas-st-komplettregale' },
          { label: 'META MULTISTRONG Grundregale', href: '/multistrong-grundregale' },
          { label: 'Kragarmregal Zubehör', href: '/kragarmregal-zubehoer' }
        ]
      },
      {
        keys: ['weitspann', 'mini rack', 'minirack', 'speed rack', 'speedrack'],
        title: 'Alles zu META Weitspannregalen',
        href: '/weitspannregale/',
        links: [
          { label: 'META MINI-RACK Grundregale', href: '/mini-rack-grundregale' },
          { label: 'META SPEED-RACK Komplettregale', href: '/speed-rack-komplettregale' },
          { label: 'Weitspannregal Zubehör', href: '/weitspannregal-zubehoer' }
        ]
      },
      {
        keys: ['werkstatt', 'handwerk'],
        title: 'Regale für Handwerk und Werkstatt',
        href: '/branchen/handwerk-werkstatt',
        links: []
      }
    ],
    // Regalsysteme für die Seite ohne Treffer (Namen wie im Shop-Menü).
    systems: [
      { label: 'Fachbodenregale', sub: 'META CLIP', href: '/fachbodenregale/' },
      { label: 'Büroregale', sub: 'META COMPACT', href: '/bueroregale' },
      { label: 'Palettenregale', sub: 'META MULTIPAL', href: '/palettenregale/' },
      { label: 'Kragarmregale', sub: 'META ATLAS ST, MULTISTRONG', href: '/kragarmregale/' },
      { label: 'Weitspannregale', sub: 'META MINI-RACK, SPEED-RACK', href: '/weitspannregale/' },
      { label: 'Zubehör', sub: 'für alle Regalsysteme', href: '/zubehoer' }
    ],
    contact: {
      phone: '02932 957-0',
      phoneHref: 'tel:+4929329570',
      hours: 'Montag bis Freitag, 8:15 bis 16:30 Uhr',
      email: 'digital-service@meta-online.com',
      configuratorHref: 'https://metacalc.meta-online.com/'
    }
  };

  function normalize(text) {
    return ' ' + String(text || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  }

  // Thema zum Suchbegriff: der Treffer, der am weitesten vorne steht; bei Gleichstand die Reihenfolge in topics.
  function matchTopic(query, topics) {
    var text = normalize(query);
    var best = null;
    var bestPos = Infinity;
    (topics || CONFIG.topics).forEach(function (topic) {
      topic.keys.forEach(function (key) {
        var pos = text.indexOf(key);
        if (pos !== -1 && pos < bestPos) {
          best = topic;
          bestPos = pos;
        }
      });
    });
    return best;
  }

  // Welche Filter bleiben sichtbar? filters: [{ label, active }] in Shop-Reihenfolge → [true/false].
  function planFilters(filters) {
    if (filters.length <= CONFIG.maxVisibleFilters) return filters.map(function () { return true; });
    var primary = CONFIG.primaryFilters.map(function (l) { return l.toLowerCase(); });
    var visible = filters.map(function (f) {
      return f.active || primary.indexOf(String(f.label || '').trim().toLowerCase()) !== -1;
    });
    var count = visible.filter(Boolean).length;
    if (count < CONFIG.minPrimaryFilters) {
      for (var i = 0; i < filters.length && count < CONFIG.fillUpFilters; i++) {
        if (!visible[i]) {
          visible[i] = true;
          count++;
        }
      }
    }
    return visible;
  }

  var api = { config: CONFIG, normalize: normalize, matchTopic: matchTopic, planFilters: planFilters };
  if (typeof window === 'undefined' || typeof document === 'undefined') return api;
  if (CONFIG.salesChannelIds.indexOf(window.salesChannelId) === -1) return api;

  var idCounter = 0;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function link(className, href, text) {
    var a = el('a', className, text);
    a.href = href;
    return a;
  }

  function searchTerm() {
    try { return new URLSearchParams(window.location.search).get('search') || ''; } catch (e) { return ''; }
  }

  // 1. Hinweis über den Treffern
  function renderHint(topic) {
    var section = el('aside', 'meta-search-hint');
    var heading = el('p', 'meta-search-hint__title');
    heading.appendChild(link('meta-search-hint__main', topic.href, topic.title));
    section.appendChild(heading);
    if (topic.links.length) {
      var label = el('span', 'meta-search-hint__label', 'Direkt zu:');
      var list = el('ul', 'meta-search-hint__links');
      topic.links.forEach(function (l) {
        var li = el('li');
        li.appendChild(link('meta-search-hint__link', l.href, l.label));
        list.appendChild(li);
      });
      var row = el('div', 'meta-search-hint__row');
      row.appendChild(label);
      row.appendChild(list);
      section.appendChild(row);
    }
    section.setAttribute('aria-label', 'Passende Themenseite');
    return section;
  }

  function handleHint(page) {
    if (page.querySelector('.meta-search-hint')) return;
    var topic = matchTopic(searchTerm());
    var headline = page.querySelector('.search-headline');
    if (!topic || !headline) return;
    headline.insertAdjacentElement('afterend', renderHint(topic));
  }

  // 2. Filter kürzen
  function filterLabel(item) {
    var toggle = item.querySelector('.filter-panel-item-toggle');
    return toggle ? toggle.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function filterActive(item) {
    if (item.querySelector('input[type="checkbox"]:checked')) return true;
    var inputs = item.querySelectorAll('.filter-range input');
    for (var i = 0; i < inputs.length; i++) if (inputs[i].value) return true;
    return false;
  }

  function handleFilters(container) {
    var items = [];
    for (var i = 0; i < container.children.length; i++) {
      if (container.children[i].classList.contains('filter-panel-item')) items.push(container.children[i]);
    }
    var visible = planFilters(items.map(function (item) { return { label: filterLabel(item), active: filterActive(item) }; }));
    var hidden = 0;
    items.forEach(function (item, i) {
      item.classList.toggle('meta-search-filter--extra', !visible[i]);
      if (!visible[i]) hidden++;
    });
    var button = container.querySelector(':scope > .meta-search-filters__more');
    if (!hidden) {
      container.classList.remove('meta-search-filters');
      if (button) button.parentNode.removeChild(button);
      return;
    }
    if (!container.classList.contains('meta-search-filters')) {
      container.classList.add('meta-search-filters', 'is-collapsed');
    }
    if (!button) {
      button = el('button', 'meta-search-filters__more');
      button.type = 'button';
      container.appendChild(button);
    }
    var collapsed = container.classList.contains('is-collapsed');
    var text = collapsed ? 'Weitere Filter (' + hidden + ')' : 'Weniger Filter';
    if (button.textContent !== text) button.textContent = text;
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  // 3. Leere Treffer
  function renderHelp() {
    var c = CONFIG.contact;
    var section = el('section', 'meta-search-help');
    var headingId = 'meta-search-help-' + (++idCounter);
    section.setAttribute('aria-labelledby', headingId);

    var tips = el('div', 'meta-search-help__tips');
    var h = el('h2', 'meta-search-help__heading', 'So finden Sie das passende Regal');
    h.id = headingId;
    tips.appendChild(h);
    var ul = el('ul', 'meta-search-help__list');
    [
      'Prüfen Sie die Schreibweise oder versuchen Sie einen allgemeineren Begriff, zum Beispiel „Fachbodenregal“ statt einer genauen Maßangabe.',
      'Sie kennen die Artikelnummer? Geben Sie sie direkt in die Suche ein.',
      'Oder wählen Sie ein Regalsystem und grenzen Sie dort mit den Filtern ein.'
    ].forEach(function (t) { ul.appendChild(el('li', null, t)); });
    tips.appendChild(ul);
    section.appendChild(tips);

    var systems = el('ul', 'meta-search-help__systems');
    CONFIG.systems.forEach(function (s) {
      var li = el('li');
      var a = link('meta-search-help__system', s.href, '');
      a.appendChild(el('span', 'meta-search-help__system-name', s.label));
      a.appendChild(el('span', 'meta-search-help__system-sub', s.sub));
      li.appendChild(a);
      systems.appendChild(li);
    });
    section.appendChild(systems);

    var contact = el('div', 'meta-search-help__contact');
    contact.appendChild(el('h2', 'meta-search-help__heading', 'Persönliche Beratung'));
    contact.appendChild(el('p', null, 'Wir beraten Sie persönlich und stellen die passenden Regale für Ihr Lager zusammen.'));
    var actions = el('div', 'meta-search-help__actions');
    actions.appendChild(link('btn btn-primary meta-search-help__phone', c.phoneHref, c.phone));
    actions.appendChild(link('meta-search-help__mail', 'mailto:' + c.email, c.email));
    contact.appendChild(actions);
    contact.appendChild(el('p', 'meta-search-help__hours', c.hours));
    var config = el('p', 'meta-search-help__config');
    config.appendChild(document.createTextNode('Regal selbst zusammenstellen: '));
    var cl = link(null, c.configuratorHref, 'Produktkonfigurator');
    cl.target = '_blank';
    cl.rel = 'noopener';
    config.appendChild(cl);
    contact.appendChild(config);
    section.appendChild(contact);
    return section;
  }

  function handleEmpty(page) {
    if (page.querySelector('.meta-search-help')) return;
    if (page.querySelector('.product-box, .filter-panel-item')) return;
    var alert = page.querySelector('.cms-element-product-listing .alert');
    if (!alert) return;
    // Hinter die Listenzeile: die ist ein Raster mit Spalten für Produktkacheln.
    var row = alert.closest('.cms-listing-row') || alert;
    row.insertAdjacentElement('afterend', renderHelp());
  }

  function scan() {
    var page = document.querySelector('.search-page');
    if (!page) return;
    handleHint(page);
    handleEmpty(page);
    document.querySelectorAll('.filter-panel-items-container').forEach(handleFilters);
  }

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; scan(); }, 100);
  }

  function start() {
    if (!document.querySelector('.search-page')) return;
    scan();
    // Delegiert, weil Shopware das Filterfeld am Handy ins Seitenmenü kopiert.
    document.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('.meta-search-filters__more');
      if (!button) return;
      button.parentNode.classList.toggle('is-collapsed');
      handleFilters(button.parentNode);
    });
    document.addEventListener('change', schedule);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return api;
})();
