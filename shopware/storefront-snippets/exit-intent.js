/*
 * METAorder: Newsletter-Modal mit Willkommensrabatt, wenn Besucher die Seite verlassen wollen (Exit-Intent).
 *
 * Quelle: shopware/storefront-snippets/exit-intent.js im METAorder-Repo.
 * Eingespielt über das Plugin „Eigenes CSS/JS" (DneCustomCssJs) per scripts/writeExitIntent.ts,
 * die Aktion mit dem Code legt scripts/writeExitIntentPromotion.ts an. Änderungen im Shop-Admin
 * überschreibt der nächste Lauf.
 *
 * Auslöser: am Desktop verlässt die Maus das Fenster nach oben (Richtung Tabs/Adresszeile),
 * am Handy ein schnelles Hochscrollen, nachdem der Besucher weit genug gelesen hat. Beides erst
 * nach einer Mindest-Verweildauer und nicht für angemeldete Kunden, im Checkout oder im Konto.
 * Nach „Nein danke" ruht das Modal einige Tage, nach der Anmeldung für immer.
 *
 * Anmeldung: dasselbe Formular wie im Footer (POST /form/newsletter, Double-Opt-in von Shopware,
 * Abgleich mit Brevo über das Plugin). Danach zeigt das Modal den Code und kann ihn direkt im
 * Warenkorb hinterlegen (POST /checkout/promotion/add). Ist der Warenkorb noch leer, wird der Code
 * vorgemerkt und beim ersten Artikel im Warenkorb hinterlegt (Shopware verwirft Codes im leeren Warenkorb).
 *
 * Zum Testen: window.MetaExitIntent.open() öffnet das Modal sofort, .reset() vergisst die Auswahl.
 */
var MetaExitIntent = (function () {
  'use strict';

  var CONFIG = {
    version: '1',
    // Nur der Onlineshop „META Regalbau DE" (gleiche ID im Testshop und im Live-Shop).
    salesChannelIds: ['018ec134507f703b82a76467791e7e61'],
    // Muss zur Aktion aus scripts/writeExitIntentPromotion.ts passen.
    code: 'WILLKOMMEN10',
    discountLabel: '10 %',
    storageKey: 'meta-exit-intent',
    // Erst nach dieser Zeit auf der Seite (ms)
    minDwellMs: 8000,
    // Nach „Nein danke" bzw. Schließen erst nach so vielen Tagen wieder
    snoozeDays: 7,
    // Handy: Hochscrollen um mindestens so viele px innerhalb von velocityWindowMs …
    mobileScrollUpPx: 140,
    velocityWindowMs: 350,
    // … nachdem mindestens dieser Anteil der Seite gelesen wurde
    mobileMinScrollShare: 0.35,
    // Hier nie: Checkout, Konto, Anmeldung, Newsletter-Bestätigung, Pflichtseiten
    excludedPaths: [
      /^\/checkout\//,
      /^\/account(\/|$)/,
      /^\/b2b/,
      /^\/newsletter-subscribe/,
      /^\/widgets\//,
      /^\/(datenschutz|impressum|agb|widerrufsrecht|widerruf)/
    ],
    privacyHref: '/datenschutz'
  };

  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function isExcludedPath(pathname) {
    var path = String(pathname || '/');
    return CONFIG.excludedPaths.some(function (re) { return re.test(path); });
  }

  function isValidEmail(value) {
    return EMAIL.test(String(value || '').trim());
  }

  /** Gespeicherter Zustand → darf das Modal (wieder) erscheinen? */
  function allowedByState(state, now) {
    if (!state || typeof state !== 'object') return true;
    if (state.status === 'subscribed') return false;
    if (state.status === 'dismissed') {
      var at = Number(state.at) || 0;
      return now - at >= CONFIG.snoozeDays * 24 * 60 * 60 * 1000;
    }
    return true;
  }

  /** Antwort von /form/newsletter: Liste von { type, alert }. Erfolg, wenn kein danger-Eintrag dabei ist. */
  function newsletterSucceeded(payload) {
    if (!Array.isArray(payload) || payload.length === 0) return false;
    return payload.every(function (entry) { return entry && entry.type !== 'danger' && entry.type !== 'error'; });
  }

  var api = {
    config: CONFIG,
    isExcludedPath: isExcludedPath,
    isValidEmail: isValidEmail,
    allowedByState: allowedByState,
    newsletterSucceeded: newsletterSucceeded
  };
  if (typeof window === 'undefined' || typeof document === 'undefined') return api;
  if (CONFIG.salesChannelIds.indexOf(window.salesChannelId) === -1) return api;

  // --- Speicher (darf fehlen, z. B. im privaten Fenster) ---------------------------------------
  var memoryState = null;
  function readState() {
    try {
      var raw = window.localStorage.getItem(CONFIG.storageKey);
      return raw ? JSON.parse(raw) : memoryState;
    } catch (e) {
      return memoryState;
    }
  }
  function writeState(state) {
    memoryState = state;
    try { window.localStorage.setItem(CONFIG.storageKey, JSON.stringify(state)); } catch (e) { /* ohne Speicher */ }
  }
  function shownThisSession() {
    try { return window.sessionStorage.getItem(CONFIG.storageKey) === '1'; } catch (e) { return false; }
  }
  function markShownThisSession() {
    try { window.sessionStorage.setItem(CONFIG.storageKey, '1'); } catch (e) { /* ohne Speicher */ }
  }

  function track(action) {
    if (!Array.isArray(window.dataLayer)) return;
    window.dataLayer.push({ event: 'meta_exit_intent', exitIntentAction: action });
  }

  function isLoggedIn() {
    return !!document.querySelector('a[href*="/account/logout"]');
  }

  // Nicht über Cookie-Banner, offene Bootstrap-Modals oder Offcanvas (Warenkorb, Menü) legen.
  function pageIsBusy() {
    if (document.querySelector('.modal.show, .offcanvas.show')) return true;
    var cookie = document.querySelector('.cookie-permission-container');
    return !!(cookie && cookie.offsetParent !== null && getComputedStyle(cookie).display !== 'none');
  }

  // --- Modal --------------------------------------------------------------------------------
  var root = null;
  var dialog = null;
  var lastFocus = null;
  var isOpen = false;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function build() {
    root = el('div', 'meta-exit');
    root.hidden = true;

    var backdrop = el('div', 'meta-exit__backdrop');
    backdrop.addEventListener('click', function () { close('backdrop'); });

    dialog = el('div', 'meta-exit__dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'meta-exit-title');
    dialog.setAttribute('aria-describedby', 'meta-exit-lead');

    var closeBtn = el('button', 'meta-exit__close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Schließen');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="square" fill="none"/></svg>';
    closeBtn.addEventListener('click', function () { close('close'); });

    // Linke Seite: das Angebot, rein typografisch im META-Rot
    var visual = el('div', 'meta-exit__visual');
    visual.setAttribute('aria-hidden', 'true');
    visual.appendChild(el('span', 'meta-exit__visual-kicker', 'Willkommensrabatt'));
    var big = el('span', 'meta-exit__visual-value', CONFIG.discountLabel.replace(' %', ''));
    big.appendChild(el('span', 'meta-exit__visual-unit', '%'));
    visual.appendChild(big);
    visual.appendChild(el('span', 'meta-exit__visual-note', 'auf Ihre erste Bestellung'));
    visual.appendChild(el('span', 'meta-exit__visual-grid'));

    var body = el('div', 'meta-exit__body');
    body.appendChild(buildFormStep());
    body.appendChild(buildSuccessStep());

    dialog.appendChild(closeBtn);
    dialog.appendChild(visual);
    dialog.appendChild(body);
    root.appendChild(backdrop);
    root.appendChild(dialog);
    document.body.appendChild(root);

    root.addEventListener('keydown', onKeydown);
  }

  var form, emailInput, errorBox, submitBtn, successStep, formStep, codeValue, copyBtn, applyBtn, applyStatus;

  function buildFormStep() {
    formStep = el('div', 'meta-exit__step meta-exit__step--form');
    formStep.appendChild(el('p', 'meta-exit__eyebrow', 'Bevor Sie gehen'));
    var title = el('h2', 'meta-exit__title', CONFIG.discountLabel + ' auf Ihre erste Bestellung');
    title.id = 'meta-exit-title';
    formStep.appendChild(title);
    var lead = el('p', 'meta-exit__lead', 'Melden Sie sich für den META-Newsletter an. Ihren Rabattcode erhalten Sie sofort, dazu Neuheiten und Aktionen rund um unsere Regalsysteme.');
    lead.id = 'meta-exit-lead';
    formStep.appendChild(lead);

    form = el('form', 'meta-exit__form');
    form.noValidate = true;
    form.setAttribute('action', '/form/newsletter');
    form.setAttribute('method', 'post');

    var label = el('label', 'meta-exit__label', 'Geschäftliche E-Mail-Adresse');
    label.setAttribute('for', 'meta-exit-email');
    emailInput = el('input', 'meta-exit__input');
    emailInput.type = 'email';
    emailInput.id = 'meta-exit-email';
    emailInput.name = 'email';
    emailInput.required = true;
    emailInput.autocomplete = 'email';
    emailInput.placeholder = 'name@firma.de';
    emailInput.setAttribute('aria-describedby', 'meta-exit-error');

    // Honeypot wie im Footer-Formular (Shopware prüft das Feld)
    var honeypot = el('input');
    honeypot.type = 'text';
    honeypot.name = 'shopware_surname_confirm';
    honeypot.tabIndex = -1;
    honeypot.autocomplete = 'off';
    honeypot.className = 'meta-exit__hp';
    honeypot.setAttribute('aria-hidden', 'true');

    errorBox = el('p', 'meta-exit__error');
    errorBox.id = 'meta-exit-error';
    errorBox.setAttribute('role', 'alert');

    submitBtn = el('button', 'btn btn-primary meta-exit__submit', 'Rabattcode erhalten');
    submitBtn.type = 'submit';

    var row = el('div', 'meta-exit__row');
    row.appendChild(emailInput);
    row.appendChild(submitBtn);

    form.appendChild(label);
    form.appendChild(row);
    form.appendChild(honeypot);
    form.appendChild(errorBox);
    form.addEventListener('submit', onSubmit);
    formStep.appendChild(form);

    var legal = el('p', 'meta-exit__legal');
    legal.appendChild(document.createTextNode('Mit der Anmeldung willigen Sie ein, den META-Newsletter per E-Mail zu erhalten. Sie bekommen dafür eine Bestätigungs-E-Mail und können sich jederzeit abmelden. Mehr in der '));
    var privacy = el('a', null, 'Datenschutzerklärung');
    privacy.href = CONFIG.privacyHref;
    privacy.target = '_blank';
    privacy.rel = 'noopener';
    legal.appendChild(privacy);
    legal.appendChild(document.createTextNode('.'));
    formStep.appendChild(legal);

    var decline = el('button', 'meta-exit__decline', 'Nein danke');
    decline.type = 'button';
    decline.addEventListener('click', function () { close('decline'); });
    formStep.appendChild(decline);
    return formStep;
  }

  function buildSuccessStep() {
    successStep = el('div', 'meta-exit__step meta-exit__step--success');
    successStep.hidden = true;
    successStep.setAttribute('tabindex', '-1');

    var check = el('span', 'meta-exit__check');
    check.setAttribute('aria-hidden', 'true');
    check.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" fill="none"/></svg>';
    successStep.appendChild(check);
    var title = el('h2', 'meta-exit__title', 'Danke! Hier ist Ihr Code');
    title.id = 'meta-exit-success-title';
    successStep.appendChild(title);
    successStep.appendChild(el('p', 'meta-exit__lead', 'Geben Sie den Code im Warenkorb ein oder hinterlegen Sie ihn gleich hier.'));

    var codeBox = el('div', 'meta-exit__code');
    codeValue = el('span', 'meta-exit__code-value', CONFIG.code);
    copyBtn = el('button', 'meta-exit__copy', 'Kopieren');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', copyCode);
    codeBox.appendChild(codeValue);
    codeBox.appendChild(copyBtn);
    successStep.appendChild(codeBox);

    applyBtn = el('button', 'btn btn-primary meta-exit__apply', 'Code im Warenkorb hinterlegen');
    applyBtn.type = 'button';
    applyBtn.addEventListener('click', applyCode);
    successStep.appendChild(applyBtn);
    applyStatus = el('p', 'meta-exit__status');
    applyStatus.setAttribute('role', 'status');
    successStep.appendChild(applyStatus);

    var notice = el('p', 'meta-exit__notice');
    notice.innerHTML = '<strong>Bitte bestätigen Sie noch Ihre Anmeldung</strong> über den Link in der E-Mail, die wir Ihnen gerade geschickt haben.';
    successStep.appendChild(notice);
    successStep.appendChild(el('p', 'meta-exit__legal', 'Gilt einmal pro Kunde für die erste Bestellung im META Onlineshop. Nicht mit anderen Aktionen kombinierbar.'));

    var done = el('button', 'meta-exit__decline', 'Weiter einkaufen');
    done.type = 'button';
    done.addEventListener('click', function () { close('done'); });
    successStep.appendChild(done);
    return successStep;
  }

  function setError(text) {
    errorBox.textContent = text || '';
    emailInput.setAttribute('aria-invalid', text ? 'true' : 'false');
  }

  function onSubmit(event) {
    event.preventDefault();
    var email = emailInput.value.trim();
    if (!isValidEmail(email)) {
      setError('Bitte geben Sie eine gültige E-Mail-Adresse ein.');
      emailInput.focus();
      return;
    }
    setError('');
    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');
    var data = new FormData(form);
    data.set('email', email);
    data.set('option', 'subscribe');

    fetch('/form/newsletter', {
      method: 'POST',
      body: data,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (payload) {
        if (!newsletterSucceeded(payload)) throw new Error('rejected');
        writeState({ status: 'subscribed', at: Date.now(), v: CONFIG.version });
        track('subscribe');
        showSuccess();
      })
      .catch(function () {
        setError('Das hat leider nicht geklappt. Bitte prüfen Sie die Adresse oder versuchen Sie es später noch einmal.');
        track('error');
      })
      .then(function () {
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-loading');
      });
  }

  function showSuccess() {
    formStep.hidden = true;
    successStep.hidden = false;
    dialog.setAttribute('aria-labelledby', 'meta-exit-success-title');
    dialog.removeAttribute('aria-describedby');
    successStep.focus();
  }

  function copyCode() {
    var done = function () {
      copyBtn.textContent = 'Kopiert';
      copyBtn.classList.add('is-done');
      track('copy');
      setTimeout(function () { copyBtn.textContent = 'Kopieren'; copyBtn.classList.remove('is-done'); }, 2200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(CONFIG.code).then(done, selectCode);
    } else {
      selectCode();
    }
  }

  function selectCode() {
    var range = document.createRange();
    range.selectNodeContents(codeValue);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function cartCount() {
    var badge = document.querySelector('.header-cart-badge');
    return badge ? parseInt(badge.textContent, 10) || 0 : 0;
  }

  // Shopware verwirft Codes in einem leeren Warenkorb. Deshalb erst hinterlegen, wenn etwas drin liegt.
  function postCode() {
    var data = new FormData();
    data.set('code', CONFIG.code);
    return fetch('/checkout/promotion/add', {
      method: 'POST',
      body: data,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var state = readState() || {};
      state.pendingApply = false;
      state.applied = true;
      writeState(state);
    });
  }

  var cartObserver = null;
  /** Vorgemerkten Code hinterlegen, sobald der Warenkorb-Zähler im Kopf etwas zeigt (auch nach Ajax-Nachladen) */
  function watchCartForCode() {
    var state = readState();
    if (!state || state.status !== 'subscribed' || !state.pendingApply || state.applied) return;
    if (cartCount() > 0) {
      postCode().then(function () { track('apply:auto'); }, function () { /* nächster Seitenaufruf */ });
      return;
    }
    var widget = document.querySelector('[data-cart-widget]') || document.querySelector('.header-cart');
    if (!widget || cartObserver || typeof MutationObserver === 'undefined') return;
    cartObserver = new MutationObserver(function () {
      if (cartCount() === 0) return;
      cartObserver.disconnect();
      cartObserver = null;
      watchCartForCode();
    });
    cartObserver.observe(widget, { childList: true, subtree: true, characterData: true });
  }

  // Fertig-Zustand ohne disabled: das Theme färbt deaktivierte Buttons mit !important grau
  function markApplied(label) {
    applyBtn.disabled = false;
    applyBtn.setAttribute('aria-disabled', 'true');
    applyBtn.textContent = label;
    applyBtn.classList.add('is-done');
  }

  function applyCode() {
    if (applyBtn.getAttribute('aria-disabled') === 'true') return;
    applyBtn.disabled = true;
    applyStatus.textContent = '';
    if (cartCount() === 0) {
      var state = readState() || { status: 'subscribed', at: Date.now(), v: CONFIG.version };
      state.pendingApply = true;
      writeState(state);
      markApplied('Code ist vorgemerkt');
      applyStatus.textContent = 'Ihr Warenkorb ist noch leer. Wir hinterlegen den Code automatisch, sobald Sie etwas hineinlegen.';
      track('apply:pending');
      watchCartForCode();
      return;
    }
    postCode()
      .then(function () {
        markApplied('Im Warenkorb hinterlegt');
        applyStatus.textContent = 'Der Rabatt wird an der Kasse abgezogen, sobald Sie angemeldet sind oder Ihre Daten eingegeben haben.';
        track('apply');
      })
      .catch(function () {
        applyBtn.disabled = false;
        applyStatus.textContent = 'Das hat nicht geklappt. Bitte geben Sie den Code im Warenkorb ein.';
      });
  }

  function focusables() {
    return Array.prototype.filter.call(
      dialog.querySelectorAll('a[href], button:not([disabled]), input:not([tabindex="-1"]):not([disabled])'),
      function (node) { return node.offsetParent !== null; }
    );
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close('escape');
      return;
    }
    if (event.key !== 'Tab') return;
    var items = focusables();
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function open(source) {
    if (isOpen) return;
    if (!root) build();
    isOpen = true;
    lastFocus = document.activeElement;
    // Ans Ende von body, damit es über dem später geladenen Chat-Fenster liegt (gleicher z-index)
    document.body.appendChild(root);
    root.hidden = false;
    document.documentElement.classList.add('meta-exit-open');
    // Layout erzwingen, dann die Klasse setzen, damit die Einblendung animiert (rAF läuft in Hintergrund-Tabs nicht)
    void root.offsetWidth;
    root.classList.add('is-visible');
    markShownThisSession();
    track('view' + (source ? ':' + source : ''));
    setTimeout(function () {
      if (!formStep.hidden) emailInput.focus(); else successStep.focus();
    }, 60);
  }

  function close(reason) {
    if (!isOpen) return;
    isOpen = false;
    var state = readState();
    if (!state || state.status !== 'subscribed') writeState({ status: 'dismissed', at: Date.now(), v: CONFIG.version });
    track('close:' + reason);
    root.classList.remove('is-visible');
    document.documentElement.classList.remove('meta-exit-open');
    var finish = function () { root.hidden = true; };
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else setTimeout(finish, 220);
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  // --- Auslöser -----------------------------------------------------------------------------
  var startedAt = Date.now();
  var armed = false;

  function canTrigger() {
    return armed && !isOpen && !shownThisSession() && allowedByState(readState(), Date.now()) && !pageIsBusy();
  }

  function trigger(source) {
    if (!canTrigger()) return;
    teardown();
    open(source);
  }

  function onMouseOut(event) {
    if (event.relatedTarget || event.toElement) return;
    if (event.clientY > 8) return;
    trigger('mouse');
  }

  var scrollSamples = [];
  var maxScrollY = 0;
  function onScroll() {
    var y = window.scrollY || window.pageYOffset || 0;
    var now = Date.now();
    if (y > maxScrollY) maxScrollY = y;
    scrollSamples.push({ y: y, t: now });
    while (scrollSamples.length && now - scrollSamples[0].t > CONFIG.velocityWindowMs) scrollSamples.shift();
    var scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    if (maxScrollY / scrollable < CONFIG.mobileMinScrollShare) return;
    var peak = scrollSamples.reduce(function (m, s) { return Math.max(m, s.y); }, 0);
    if (peak - y >= CONFIG.mobileScrollUpPx && y > 200) trigger('scroll');
  }

  var touch = window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;

  function teardown() {
    document.removeEventListener('mouseout', onMouseOut);
    window.removeEventListener('scroll', onScroll);
  }

  function init() {
    watchCartForCode();
    if (isExcludedPath(window.location.pathname)) return;
    if (isLoggedIn()) return;
    if (!allowedByState(readState(), Date.now()) || shownThisSession()) return;
    setTimeout(function () { armed = true; }, Math.max(0, CONFIG.minDwellMs - (Date.now() - startedAt)));
    if (touch) window.addEventListener('scroll', onScroll, { passive: true });
    else document.addEventListener('mouseout', onMouseOut);
  }

  api.open = function () { open('manual'); };
  api.reset = function () {
    memoryState = null;
    try { window.localStorage.removeItem(CONFIG.storageKey); window.sessionStorage.removeItem(CONFIG.storageKey); } catch (e) { /* ohne Speicher */ }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return api;
})();
