/*
 * METAorder: Regalplaner META CLIP (3D-Konfigurator) auf der Shop-Seite /regalplaner.
 *
 * Quelle: shopware/storefront-snippets/regalplaner.js im METAorder-Repo.
 * Eingespielt über das Plugin „Eigenes CSS/JS" (DneCustomCssJs) per
 * scripts/writeRegalplaner.ts. Änderungen im Shop-Admin überschreibt der nächste Lauf.
 *
 * Die Seite (scripts/writeRegalplanerPage.ts) enthält einen Platzhalter mit der Adresse von METAorder
 * (data-app). Das Skript setzt dort METAorder als iframe ein (<app>/regalplaner?shop=<diese Shop-Adresse>)
 * und hört auf zwei Nachrichten, nur von genau dieser Adresse (client/src/pages/metaClip/shopEmbed.ts):
 * - height: Höhe des Rahmens an den Inhalt anpassen (kein zweiter Rollbalken).
 * - cart: Stückliste in den Warenkorb legen, in der Sitzung des Besuchers. Händler- und Kundenpreise
 *   rechnet damit der Shop selbst; METAorder zeigt ohne Anmeldung nur Katalogpreise.
 * Umgekehrt meldet das Skript beim Scrollen, wie viel vom Rahmen oben verdeckt ist (viewport, auch unter einer
 * mitlaufenden Kopfzeile). Damit bleibt die 3D-Ansicht am Desktop stehen, während man die Einstellungen scrollt.
 */
var MetaRegalplaner = (function () {
  'use strict';

  var CONFIG = {
    version: '3',
    // Nur der Onlineshop „META Regalbau DE" (gleiche ID im Testshop und im Live-Shop).
    salesChannelIds: ['018ec134507f703b82a76467791e7e61'],
    source: 'metaorder-regalplaner',
    maxItems: 60,
    maxQuantity: 999,
    minHeight: 600
  };

  /** Adresse von METAorder aus data-app, nur https (http nur für localhost beim Testen). */
  function appOrigin(raw) {
    try {
      var url = new URL(raw);
      var local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
      return url.origin;
    } catch (e) {
      return null;
    }
  }

  /** Positionen aus der Nachricht prüfen: Shopware-IDs (32 hex) und ganze Mengen, gleiche Artikel zusammengefasst. */
  function cartPositions(data) {
    if (!data || !Array.isArray(data.items) || !data.items.length || data.items.length > CONFIG.maxItems) return null;
    var byId = {};
    var order = [];
    for (var i = 0; i < data.items.length; i++) {
      var item = data.items[i] || {};
      var id = String(item.id || '');
      var qty = Number(item.quantity);
      if (!/^[0-9a-f]{32}$/.test(id) || !(qty >= 1) || qty !== Math.floor(qty)) return null;
      if (!byId[id]) { byId[id] = 0; order.push(id); }
      byId[id] += qty;
      if (byId[id] > CONFIG.maxQuantity) return null;
    }
    return order.map(function (id) { return { id: id, qty: byId[id] }; });
  }

  /** Verdeckter Teil des Rahmens oben (px): über den Bildschirmrand gescrollt oder unter der Kopfzeile. */
  function hiddenTop(frameTop, coveredBottom) {
    return Math.max(0, Math.round(coveredBottom - frameTop));
  }

  var api = { config: CONFIG, appOrigin: appOrigin, cartPositions: cartPositions, hiddenTop: hiddenTop };
  if (typeof window === 'undefined' || typeof document === 'undefined') return api;
  if (CONFIG.salesChannelIds.indexOf(window.salesChannelId) === -1) return api;

  function hidden(form, name, value) {
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  function addToCart(positions) {
    // Formular eines früheren Klicks entfernen (es bleibt sonst unsichtbar im DOM)
    document.querySelectorAll('form.meta-rp__cart').forEach(function (old) { old.remove(); });
    var form = document.createElement('form');
    form.action = '/checkout/line-item/add';
    form.method = 'post';
    form.className = 'meta-rp__cart';
    form.hidden = true;
    form.setAttribute('data-add-to-cart', 'true');
    hidden(form, 'redirectTo', 'frontend.cart.offcanvas');
    positions.forEach(function (p) {
      var key = 'lineItems[' + p.id + ']';
      hidden(form, key + '[id]', p.id);
      hidden(form, key + '[type]', 'product');
      hidden(form, key + '[referencedId]', p.id);
      hidden(form, key + '[quantity]', String(p.qty));
      hidden(form, key + '[stackable]', '1');
      hidden(form, key + '[removable]', '1');
    });
    document.body.appendChild(form);

    // Ohne Shopware-Plugin normal absenden und zum Warenkorb wechseln
    function submitPlain() {
      form.removeAttribute('data-add-to-cart');
      form.querySelector('input[name="redirectTo"]').value = 'frontend.checkout.cart.page';
      form.submit();
    }
    var manager = window.PluginManager;
    if (!manager || typeof form.requestSubmit !== 'function') { submitPlain(); return; }
    // Shopware-Plugin: Warenkorb im Seitenmenü öffnen, Seite bleibt stehen. initializePlugin lädt das Plugin
    // seit Shopware 6.5 asynchron (Promise) – sofort abgeschickt würde der Browser das Formular normal senden
    // und den Seitenmenü-Warenkorb als eigene Seite zeigen.
    var ready;
    try {
      ready = manager.initializePlugin('AddToCart', form);
    } catch (e) {
      submitPlain();
      return;
    }
    Promise.resolve(ready).then(function () {
      var attached = typeof manager.getPluginInstanceFromElement !== 'function' || manager.getPluginInstanceFromElement(form, 'AddToCart');
      if (attached) form.requestSubmit();
      else submitPlain();
    }, submitPlain);
  }

  /** Unterkante mitlaufender Kopfzeilen (fixed/sticky am oberen Rand), sonst 0. */
  function coveredBottom() {
    if (!document.elementsFromPoint) return 0;
    var bottom = 0;
    var stack = document.elementsFromPoint(window.innerWidth / 2, 2);
    for (var i = 0; i < stack.length; i++) {
      for (var node = stack[i]; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
        var position = window.getComputedStyle(node).position;
        if (position !== 'fixed' && position !== 'sticky') continue;
        var rect = node.getBoundingClientRect();
        // Vollflächige Ebenen (Cookie-Hinweis) zählen nicht als Kopfzeile
        if (rect.top <= 2 && rect.bottom > bottom && rect.bottom < window.innerHeight / 2) bottom = rect.bottom;
        break;
      }
    }
    return bottom;
  }

  function mount(slot) {
    var origin = appOrigin(slot.getAttribute('data-app') || '');
    if (!origin || slot.querySelector('iframe')) return;
    var frame = document.createElement('iframe');
    frame.className = 'meta-rp__frame';
    frame.title = 'Regalplaner META CLIP';
    frame.src = origin + '/regalplaner?shop=' + encodeURIComponent(window.location.origin);
    frame.setAttribute('allow', 'fullscreen');
    frame.style.height = Math.max(CONFIG.minHeight, 1100) + 'px';
    slot.innerHTML = '';
    slot.appendChild(frame);

    var queued = false;
    function sendViewport() {
      queued = false;
      if (!frame.contentWindow) return;
      var top = hiddenTop(frame.getBoundingClientRect().top, coveredBottom());
      frame.contentWindow.postMessage({ source: CONFIG.source, type: 'viewport', top: top }, origin);
    }
    function queueViewport() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(sendViewport);
    }
    window.addEventListener('scroll', queueViewport, { passive: true });
    window.addEventListener('resize', queueViewport);
    frame.addEventListener('load', queueViewport);

    window.addEventListener('message', function (event) {
      if (event.origin !== origin || event.source !== frame.contentWindow) return;
      var data = event.data || {};
      if (data.source !== CONFIG.source) return;
      if (data.type === 'height') {
        var h = Number(data.height);
        if (h > 0 && h < 20000) frame.style.height = Math.max(CONFIG.minHeight, Math.ceil(h)) + 'px';
        queueViewport();
      } else if (data.type === 'cart') {
        var positions = cartPositions(data);
        if (positions) addToCart(positions);
      }
    });
  }

  function start() {
    document.querySelectorAll('[data-meta-regalplaner]').forEach(mount);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return api;
})();
