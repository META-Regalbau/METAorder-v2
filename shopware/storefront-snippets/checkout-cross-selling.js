/*
 * METAorder: „Das passt dazu" im Mini-Warenkorb und auf der Warenkorbseite.
 *
 * Quelle: shopware/storefront-snippets/checkout-cross-selling.js im METAorder-Repo.
 * Eingespielt über das Plugin „Eigenes CSS/JS" (DneCustomCssJs) per
 * scripts/writeCheckoutCrossSelling.ts. Änderungen im Shop-Admin überschreibt der nächste Lauf.
 *
 * Ablauf: Für die zuletzt hinzugefügten Artikel im Warenkorb wird die Produktseite in der
 * Sitzung des Kunden geladen (dadurch stimmen Kundengruppen- und Händlerpreise). Aus dem
 * Crossselling-Reiter „Das passt dazu" (pflegt METAorder) werden die Produkte übernommen,
 * Artikel im Warenkorb und Doppelte fallen weg. Fehler bleiben still: dann gibt es keine Leiste.
 */
var MetaCheckoutCrossSelling = (function () {
  'use strict';

  var CONFIG = {
    version: '1',
    // Nur der Onlineshop „META Regalbau DE" (gleiche ID im Testshop und im Live-Shop).
    salesChannelIds: ['018ec134507f703b82a76467791e7e61'],
    // Crossselling-Reiter, deren Produkte angezeigt werden (Kleinschreibung).
    tabTitles: ['das passt dazu'],
    heading: 'Das passt dazu',
    buyLabel: 'In den Warenkorb',
    detailsLabel: 'Details',
    maxSources: 3,
    maxOffcanvas: 4,
    maxCart: 6,
    timeoutMs: 8000
  };

  var LINE_ITEM_FORM = /\/checkout\/line-item\/(?:change-quantity|delete)\/([0-9a-f]{32})/;

  function normalize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // Reihum aus den Listen der Warenkorb-Artikel wählen, damit jeder Artikel beiträgt.
  function pick(lists, excludeIds, max) {
    var seen = {};
    var result = [];
    (excludeIds || []).forEach(function (id) { seen[id] = true; });
    var longest = lists.reduce(function (n, list) { return Math.max(n, list.length); }, 0);
    for (var i = 0; i < longest && result.length < max; i++) {
      for (var l = 0; l < lists.length && result.length < max; l++) {
        var item = lists[l][i];
        if (!item || !item.id || seen[item.id]) continue;
        seen[item.id] = true;
        result.push(item);
      }
    }
    return result;
  }

  var api = { config: CONFIG, pick: pick, normalize: normalize };
  if (typeof window === 'undefined' || typeof document === 'undefined') return api;
  if (CONFIG.salesChannelIds.indexOf(window.salesChannelId) === -1) return api;

  var cache = {};
  var headingCounter = 0;

  function lineItemIds(root) {
    var ids = [];
    root.querySelectorAll('form[action*="/checkout/line-item/"]').forEach(function (form) {
      var m = LINE_ITEM_FORM.exec(form.getAttribute('action') || '');
      if (m && ids.indexOf(m[1]) === -1) ids.push(m[1]);
    });
    return ids;
  }

  // Produktseiten der Warenkorb-Artikel, zuletzt hinzugefügte zuerst.
  function sourceUrls(root) {
    var urls = [];
    root.querySelectorAll('.line-item-product a.line-item-label[href]').forEach(function (a) {
      if (urls.indexOf(a.href) === -1) urls.push(a.href);
    });
    return urls.reverse().slice(0, CONFIG.maxSources);
  }

  function toItem(box) {
    var info = {};
    try { info = JSON.parse(box.getAttribute('data-product-information') || '{}'); } catch (e) { return null; }
    var link = box.querySelector('a.product-name');
    if (!info.id || !link) return null;
    var img = box.querySelector('img.product-image');
    var price = box.querySelector('.product-price-wrapper');
    if (price) {
      // Leere Platzhalter (z. B. „ab"-Preis ohne Varianten) brauchen im Theme sonst Platz.
      price.querySelectorAll('.product-cheapest-price, .product-price-unit').forEach(function (el) {
        if (!el.textContent.trim()) el.parentNode.removeChild(el);
      });
    }
    var form = box.querySelector('form.buy-widget');
    return {
      id: info.id,
      name: info.name || link.textContent.trim(),
      href: link.href,
      imgSrc: img ? img.getAttribute('src') : null,
      imgSrcset: img ? img.getAttribute('srcset') : null,
      imgAlt: img ? img.getAttribute('alt') || '' : '',
      priceHtml: price ? price.innerHTML : '',
      formHtml: form ? form.outerHTML : null
    };
  }

  function extract(html, baseUrl) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var base = doc.createElement('base');
    base.href = baseUrl;
    doc.head.appendChild(base);
    var items = [];
    doc.querySelectorAll('a[href^="#cross-selling-tab-"], [data-bs-target^="#cross-selling-tab-"]').forEach(function (tab) {
      if (CONFIG.tabTitles.indexOf(normalize(tab.textContent)) === -1) return;
      var target = tab.getAttribute('data-bs-target') || tab.getAttribute('href');
      var pane = doc.getElementById(target.slice(1));
      if (!pane) return;
      pane.querySelectorAll('.product-box').forEach(function (box) {
        var item = toItem(box);
        if (item) items.push(item);
      });
    });
    return items;
  }

  function load(url) {
    if (!cache[url]) {
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, CONFIG.timeoutMs) : null;
      cache[url] = fetch(url, { credentials: 'same-origin', signal: controller ? controller.signal : undefined })
        .then(function (res) { return res.ok ? res.text() : ''; })
        .then(function (html) { return html ? extract(html, url) : []; })
        .catch(function () { return []; })
        .then(function (items) {
          if (timer) clearTimeout(timer);
          if (!items.length) delete cache[url];
          return items;
        });
    }
    return cache[url];
  }

  function buildForm(item, mode) {
    var holder = document.createElement('div');
    holder.innerHTML = item.formHtml;
    var form = holder.querySelector('form');
    if (!form) return null;
    form.classList.add('meta-xsell__form');
    var grid = form.querySelector('.d-grid');
    if (grid) grid.classList.remove('d-grid');
    var button = form.querySelector('button');
    if (button) {
      button.className = 'btn btn-primary btn-sm meta-xsell__buy';
      button.textContent = CONFIG.buyLabel;
      button.setAttribute('aria-label', CONFIG.buyLabel + ': ' + item.name);
    }
    if (mode === 'cart') {
      // Auf der Warenkorbseite normal absenden und zurück zum aktualisierten Warenkorb.
      form.removeAttribute('data-add-to-cart');
      var redirect = form.querySelector('input[name="redirectTo"]');
      if (redirect) redirect.value = 'frontend.checkout.cart.page';
      var params = form.querySelector('input[name="redirectParameters"]');
      if (params) params.parentNode.removeChild(params);
    }
    return form;
  }

  function render(items, mode) {
    var headingId = 'meta-xsell-heading-' + (++headingCounter);
    var section = document.createElement('section');
    section.className = 'meta-xsell meta-xsell--' + mode;
    section.setAttribute('aria-labelledby', headingId);
    section.setAttribute('data-meta-xsell-version', CONFIG.version);

    var heading = document.createElement('h2');
    heading.className = 'meta-xsell__heading';
    heading.id = headingId;
    heading.textContent = CONFIG.heading;
    section.appendChild(heading);

    var list = document.createElement('ul');
    list.className = 'meta-xsell__list';
    items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'meta-xsell__item';

      var imageLink = document.createElement('a');
      imageLink.className = 'meta-xsell__image';
      imageLink.href = item.href;
      imageLink.tabIndex = -1;
      imageLink.setAttribute('aria-hidden', 'true');
      if (item.imgSrc) {
        var img = document.createElement('img');
        img.src = item.imgSrc;
        if (item.imgSrcset) {
          img.srcset = item.imgSrcset;
          img.sizes = mode === 'cart' ? '200px' : '72px';
        }
        img.alt = '';
        img.loading = 'lazy';
        imageLink.appendChild(img);
      }
      li.appendChild(imageLink);

      var body = document.createElement('div');
      body.className = 'meta-xsell__body';
      var name = document.createElement('a');
      name.className = 'meta-xsell__name';
      name.href = item.href;
      name.textContent = item.name;
      name.title = item.name;
      body.appendChild(name);

      var price = document.createElement('div');
      price.className = 'meta-xsell__price';
      price.innerHTML = item.priceHtml;
      body.appendChild(price);

      var form = item.formHtml ? buildForm(item, mode) : null;
      if (form) {
        body.appendChild(form);
      } else {
        var details = document.createElement('a');
        details.className = 'btn btn-outline-primary btn-sm meta-xsell__buy';
        details.href = item.href;
        details.textContent = CONFIG.detailsLabel;
        details.setAttribute('aria-label', CONFIG.detailsLabel + ': ' + item.name);
        body.appendChild(details);
      }
      li.appendChild(body);
      list.appendChild(li);
    });
    section.appendChild(list);
    return section;
  }

  function initAddToCart(section) {
    var manager = window.PluginManager;
    section.querySelectorAll('form[data-add-to-cart]').forEach(function (form) {
      try {
        manager.initializePlugin('AddToCart', form);
      } catch (e) {
        // Ohne Shopware-Plugin wie auf der Warenkorbseite normal absenden.
        form.removeAttribute('data-add-to-cart');
        var redirect = form.querySelector('input[name="redirectTo"]');
        if (redirect) redirect.value = 'frontend.checkout.cart.page';
      }
    });
  }

  function insert(root, section, mode) {
    var anchor = mode === 'cart'
      ? root.querySelector('.checkout-product-table')
      : root.querySelector('.offcanvas-cart-actions');
    if (anchor) anchor.insertAdjacentElement('afterend', section);
    else root.appendChild(section);
  }

  function handle(root, mode) {
    var ids = lineItemIds(root);
    var signature = ids.slice().sort().join(',');
    if (!signature || root.getAttribute('data-meta-xsell') === signature) return;
    root.setAttribute('data-meta-xsell', signature);

    var urls = sourceUrls(root);
    if (!urls.length) return;
    Promise.all(urls.map(load)).then(function (lists) {
      if (!document.body.contains(root) || root.getAttribute('data-meta-xsell') !== signature) return;
      var items = pick(lists, ids, mode === 'cart' ? CONFIG.maxCart : CONFIG.maxOffcanvas);
      var old = root.querySelector('.meta-xsell');
      if (old) old.parentNode.removeChild(old);
      if (!items.length) return;
      var section = render(items, mode);
      insert(root, section, mode);
      if (mode === 'offcanvas') initAddToCart(section);
    }).catch(function () { /* still */ });
  }

  function scan() {
    if (/^\/checkout\/cart\/?$/.test(window.location.pathname)) {
      var main = document.querySelector('.checkout-main');
      if (main) handle(main, 'cart');
    }
    var offcanvas = document.querySelector('.cart-offcanvas .offcanvas-cart');
    if (offcanvas) handle(offcanvas, 'offcanvas');
  }

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; scan(); }, 100);
  }

  function start() {
    scan();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return api;
})();
