/*
 * METAorder: Hinweis auf E-Mail-Werbung an Bestandskunden (§ 7 Abs. 3 UWG) an der Kasse und bei der Registrierung.
 *
 * Quelle: shopware/storefront-snippets/email-notice.js im METAorder-Repo, eingespielt über das Plugin
 * „Eigenes CSS/JS" (DneCustomCssJs) per scripts/writeEmailNotice.ts. Texte: Entwurf B0
 * (Kundenmails-Rechtstexte-Entwurf-2026-10-20.html, Texte E und F) – erst nach Freigabe durch den DSB einspielen.
 * Der Tag, an dem dieser Hinweis live geht, ist der Stichtag der Bestandskunden-Regel in METAorder.
 *
 * Kasse („Bestellung abschließen"): unter der Newsletter-Checkbox, sonst über den AGB.
 * Registrierung: unter dem Feld E-Mail-Adresse. Findet der Baustein keine passende Stelle, zeigt er nichts.
 */
var MetaEmailNotice = (function () {
  'use strict';

  var CONFIG = {
    version: '1',
    // Nur der Onlineshop „META Regalbau DE" (gleiche ID im Testshop und im Live-Shop).
    salesChannelIds: ['018ec134507f703b82a76467791e7e61'],
    privacyUrl: '/datenschutz',
    checkout:
      'Wir nutzen Ihre E-Mail-Adresse, um Sie über ähnliche Produkte von META zu informieren. Sie können dem jederzeit widersprechen, zum Beispiel über den Abmeldelink in jeder E-Mail. Dafür entstehen nur die Übermittlungskosten nach den Basistarifen. Mehr dazu in unserer ',
    register:
      'Wenn Sie bei uns bestellen, informieren wir Sie per E-Mail über ähnliche Produkte von META. Sie können dem jederzeit widersprechen, zum Beispiel über den Abmeldelink in jeder E-Mail. Dafür entstehen nur die Übermittlungskosten nach den Basistarifen. Mehr dazu in unserer ',
    privacyLabel: 'Datenschutzerklärung'
  };

  function channelOk() {
    var el = document.querySelector('[data-sales-channel-id], meta[name="sales-channel-id"]');
    var id = el ? el.getAttribute('data-sales-channel-id') || el.getAttribute('content') : null;
    // Ohne Kennung im Markup: nur Seiten des DE-Shops laden diesen Baustein (Zuordnung im Plugin)
    return !id || CONFIG.salesChannelIds.indexOf(id) !== -1;
  }

  function notice(text) {
    var p = document.createElement('p');
    p.className = 'meta-mail-notice';
    p.appendChild(document.createTextNode(text));
    var a = document.createElement('a');
    a.href = CONFIG.privacyUrl;
    a.textContent = CONFIG.privacyLabel;
    p.appendChild(a);
    p.appendChild(document.createTextNode('.'));
    return p;
  }

  function insertAfter(ref, node) {
    if (ref && ref.parentNode) ref.parentNode.insertBefore(node, ref.nextSibling);
  }

  function checkout() {
    if (document.querySelector('.meta-mail-notice')) return;
    var body = document.body;
    if (!body || !/is-act-confirmpage/.test(body.className)) return;
    var optin = document.querySelector('#confirmOrderForm input[type="checkbox"][name*="newsletter" i], #confirmOrderForm input[type="checkbox"][id*="brevo" i], #confirmOrderForm input[type="checkbox"][name*="optin" i]');
    var anchor = optin ? optin.closest('.form-check, .custom-control, .checkout-confirm-newsletter, div') : document.querySelector('.checkout-confirm-tos, .confirm-tos');
    if (!anchor) return;
    if (optin) insertAfter(anchor, notice(CONFIG.checkout));
    else anchor.parentNode.insertBefore(notice(CONFIG.checkout), anchor);
  }

  function register() {
    if (document.querySelector('.meta-mail-notice')) return;
    var mail = document.querySelector('form.register-form #personalMail, .register-personal #personalMail, form[action*="register"] input[type="email"][name="email"]');
    if (!mail) return;
    insertAfter(mail.closest('.form-group, .col-sm-6, .col-md-6, div') || mail, notice(CONFIG.register));
  }

  function init() {
    if (!channelOk()) return;
    try {
      checkout();
      register();
    } catch (e) {
      /* still: dann kein Hinweis */
    }
  }

  return { init: init, notice: notice, CONFIG: CONFIG };
})();

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', MetaEmailNotice.init);
else MetaEmailNotice.init();
