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
 */
var MetaRegalplaner = (function () {
  'use strict';

  var CONFIG = {
    version: '1',
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

  var api = { config: CONFIG, appOrigin: appOrigin, cartPositions: cartPositions };
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
    var form = document.createElement('form');
    form.action = '/checkout/line-item/add';
    form.method = 'post';
    form.className = 'meta-rp__cart';
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
    try {
      // Shopware-Plugin: Warenkorb im Seitenmenü öffnen, Seite bleibt stehen
      window.PluginManager.initializePlugin('AddToCart', form);
      if (typeof form.requestSubmit === 'function') { form.requestSubmit(); return; }
    } catch (e) {
      // ohne Plugin unten normal absenden
    }
    form.removeAttribute('data-add-to-cart');
    form.querySelector('input[name="redirectTo"]').value = 'frontend.checkout.cart.page';
    form.submit();
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

    window.addEventListener('message', function (event) {
      if (event.origin !== origin || event.source !== frame.contentWindow) return;
      var data = event.data || {};
      if (data.source !== CONFIG.source) return;
      if (data.type === 'height') {
        var h = Number(data.height);
        if (h > 0 && h < 20000) frame.style.height = Math.max(CONFIG.minHeight, Math.ceil(h)) + 'px';
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
