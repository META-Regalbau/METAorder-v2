import {
  computed,
  createApp,
  h,
  nextTick,
  onBeforeUnmount,
  reactive,
} from "vue";

const DEFAULT_TEXTS = {
  title: "CPQ Schnellpruefung",
  subtitle: "Live-Validierung und Preisindikation direkt auf der Produktseite.",
  customerGroupLabel: "Kundensegment",
  customerGroupB2c: "B2C",
  customerGroupB2bStandard: "B2B Standard",
  customerGroupB2bIndustrie: "B2B Industrie",
  heightLabel: "Hoehe (mm)",
  depthLabel: "Tiefe (mm)",
  widthLabel: "Breite (mm)",
  shelfCountLabel: "Anzahl Boeden",
  shelfLoadLabel: "Fachlast (kg)",
  anchoringLabel: "Verankerung enthalten",
  loading: "Live-Berechnung laeuft...",
  hardErrorsTitle: "Nicht zulaessig",
  softWarningsTitle: "Hinweise",
  classCNotice: "Klasse C erkannt. Technische Freigabe erforderlich.",
  classCModalTrigger: "Mehr zu Klasse C",
  classCModalTitle: "Hinweis zu Klasse C",
  classCModalBody:
    "Diese Konfiguration kann vorbereitet werden, benoetigt jedoch vor finaler Freigabe eine technische Pruefung.",
  close: "Schliessen",
  retry: "Erneut pruefen",
  netPrice: "Netto",
  grossPrice: "Brutto",
  pricingUnavailable: "Preis aktuell nicht verfuegbar",
  requestErrorPrefix: "CPQ-Fehler:",
  updatedAtPrefix: "Zuletzt aktualisiert:",
  liveRegionReady: "CPQ Pruefung bereit.",
  liveRegionLoading: "CPQ Pruefung wird aktualisiert.",
  liveRegionError: "CPQ Pruefung fehlgeschlagen.",
  liveRegionClassC: "Klasse C erkannt. Review erforderlich.",
  transferButton: "Konfiguration in Checkout uebergeben",
  transferInProgress: "Checkout-Handover laeuft...",
  transferReady: "Konfiguration fuer Checkout vorbereitet.",
  transferBlocked: "Checkout gesperrt: Klasse C muss zuerst in den Review-Prozess.",
  transferMissingProduct: "Produktdaten fehlen auf der PDP. Checkout-Handover nicht moeglich.",
  transferNoQuantity: "Menge auf der PDP ist ungueltig. Bitte Menge korrigieren.",
  transferFailedPrefix: "Checkout-Handover fehlgeschlagen:",
  transferStatusLabel: "Handover-Status",
  reviewGuidanceLabel: "Naechster Schritt",
  b2bContextNotice: "B2B-Kontext erkannt: Preise sind indikativ bis zur finalen Angebotspruefung.",
};

function parseDataAttribute(el, attributeName, fallbackValue) {
  const raw = el.getAttribute(attributeName);
  if (!raw) return fallbackValue;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return fallbackValue;
  }
}

function normalizeCustomerGroup(rawGroup) {
  const value = (rawGroup ?? "").toString().trim().toLowerCase();
  if (!value) return "b2c";
  if (value === "b2b" || value === "business") return "b2b_standard";
  if (value.includes("industrie")) return "b2b_industrie";
  if (value.includes("b2b") || value.includes("company")) return "b2b_standard";
  return "b2c";
}

function formatMoney(value, currencyIso, locale) {
  if (typeof value !== "number" || Number.isNaN(value)) return "–";
  return new Intl.NumberFormat(locale || "de-DE", {
    style: "currency",
    currency: currencyIso || "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

export function mountCpqPdpIsland(hostElement) {
  if (!hostElement) {
    return () => {};
  }

  const serverContext = parseDataAttribute(hostElement, "data-meta-clip-cpq", {});
  const translatedTexts = parseDataAttribute(hostElement, "data-meta-clip-cpq-texts", {});
  const texts = { ...DEFAULT_TEXTS, ...translatedTexts };

  const app = createApp({
    setup() {
      const state = reactive({
        customerGroup: normalizeCustomerGroup(serverContext.customerGroup),
        frame: {
          heightMm: Number(serverContext.initialConfiguration?.frame?.heightMm ?? 2000),
          depthMm: Number(serverContext.initialConfiguration?.frame?.depthMm ?? 500),
          widthMm: Number(serverContext.initialConfiguration?.frame?.widthMm ?? 1000),
          anchoringIncluded: Boolean(
            serverContext.initialConfiguration?.frame?.anchoringIncluded ?? false
          ),
        },
        shelfCount: Number(serverContext.initialConfiguration?.shelfCount ?? 4),
        shelfLoadKg: Number(serverContext.initialConfiguration?.shelfLoadKg ?? 150),
        isLoadingValidate: false,
        isLoadingPrice: false,
        hardErrors: [],
        softWarnings: [],
        requestError: null,
        classification: null,
        totals: null,
        lastUpdatedAt: null,
        liveRegionText: texts.liveRegionReady,
        classCModalOpen: false,
        isTransferLoading: false,
        transferResult: null,
        transferError: null,
      });

      const locale = serverContext.locale || "de-DE";
      const currencyIso = serverContext.currencyIso || "EUR";
      const debounceMs = Number(serverContext.debounceMs ?? 450);
      let debounceTimer = null;
      let validateAbortController = null;
      let priceAbortController = null;
      let activeRequestId = 0;
      let lastFocusedElement = null;
      let closeButtonElement = null;

      const isLoading = computed(() => state.isLoadingValidate || state.isLoadingPrice);
      const hasBlockingErrors = computed(() => state.hardErrors.length > 0);
      const hasSoftWarnings = computed(() => state.softWarnings.length > 0);
      const isClassC = computed(() => state.classification === "C");
      const canTransfer = computed(
        () => !isLoading.value && !hasBlockingErrors.value && !state.isTransferLoading
      );
      const classBadgeText = computed(() =>
        state.classification ? `Klasse ${state.classification}` : "–"
      );
      const formattedNet = computed(() =>
        formatMoney(state.totals?.net ?? Number.NaN, currencyIso, locale)
      );
      const formattedGross = computed(() =>
        formatMoney(state.totals?.gross ?? Number.NaN, currencyIso, locale)
      );

      function closeClassCModal() {
        state.classCModalOpen = false;
        if (lastFocusedElement instanceof HTMLElement) {
          lastFocusedElement.focus();
        }
      }

      function onModalKeydown(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeClassCModal();
        }
      }

      function openClassCModal(event) {
        lastFocusedElement = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
        state.classCModalOpen = true;
        nextTick(() => {
          closeButtonElement?.focus();
        });
      }

      function buildPayload() {
        return {
          context: {
            customerGroup: state.customerGroup,
            salesChannelId: serverContext.salesChannelId || undefined,
            customerId: serverContext.customerId || undefined,
          },
          configuration: {
            systemVariant: serverContext.systemVariant || "clip",
            connectionType: "clinch",
            frame: {
              heightMm: state.frame.heightMm,
              depthMm: state.frame.depthMm,
              widthMm: state.frame.widthMm,
              maxFeldlastKg: 2400,
              anchoringIncluded: state.frame.anchoringIncluded,
            },
            shelves: [
              {
                material: "stahl_verzinkt",
                maxFachlastKg: state.shelfLoadKg,
                depthMm: state.frame.depthMm,
                widthMm: state.frame.widthMm,
                count: state.shelfCount,
                position: "regular",
              },
            ],
            accessories: [],
            quantity: 1,
            deliveryCountry: serverContext.deliveryCountry || "DE",
          },
        };
      }

      function getPdpQuantity() {
        const quantityInput = document.querySelector('form[action*="/checkout/line-item/add"] input[name="quantity"]');
        const parsed = Number(quantityInput?.value ?? 1);
        if (!Number.isFinite(parsed) || parsed <= 0) return null;
        return Math.round(parsed);
      }

      async function callEndpoint(endpoint, payload, abortController) {
        const response = await fetch(`${serverContext.apiBase || "/api/cpq-core"}/${endpoint}`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: abortController.signal,
        });

        let responseBody = {};
        try {
          responseBody = await response.json();
        } catch (_jsonError) {
          responseBody = {};
        }

        if (!response.ok) {
          const errorMessage =
            responseBody?.error ||
            `${texts.requestErrorPrefix} HTTP ${response.status}`;
          const error = new Error(errorMessage);
          error.responseBody = responseBody;
          throw error;
        }

        return responseBody;
      }

      async function runLiveChecks() {
        const requestId = ++activeRequestId;

        if (validateAbortController) validateAbortController.abort();
        if (priceAbortController) priceAbortController.abort();

        validateAbortController = new AbortController();
        priceAbortController = new AbortController();

        const payload = buildPayload();
        state.isLoadingValidate = true;
        state.isLoadingPrice = true;
        state.requestError = null;
        state.transferError = null;
        state.liveRegionText = texts.liveRegionLoading;

        try {
          const [validateResult, priceResult] = await Promise.all([
            callEndpoint("validate", payload, validateAbortController),
            callEndpoint("price", payload, priceAbortController),
          ]);

          if (requestId !== activeRequestId) return;

          state.hardErrors = Array.isArray(validateResult.errors) ? validateResult.errors : [];
          state.softWarnings = Array.isArray(validateResult.disclaimers)
            ? validateResult.disclaimers
            : [];
          state.classification = validateResult.classification || null;
          state.totals = priceResult?.totals || null;
          state.lastUpdatedAt = new Date();
          state.transferResult = null;

          if (state.classification === "C") {
            state.liveRegionText = texts.liveRegionClassC;
          } else {
            state.liveRegionText = texts.liveRegionReady;
          }
        } catch (error) {
          if (error.name === "AbortError") return;
          if (requestId !== activeRequestId) return;

          state.requestError = error.message || "Unknown error";
          state.totals = null;
          state.liveRegionText = texts.liveRegionError;
        } finally {
          if (requestId === activeRequestId) {
            state.isLoadingValidate = false;
            state.isLoadingPrice = false;
          }
        }
      }

      async function submitTransfer() {
        if (!canTransfer.value) return;
        const productId = String(serverContext.productId ?? "").trim();
        const productNumber = String(serverContext.productNumber ?? "").trim();
        if (!productId) {
          state.transferError = texts.transferMissingProduct;
          return;
        }
        const quantity = getPdpQuantity();
        if (!quantity) {
          state.transferError = texts.transferNoQuantity;
          return;
        }

        const payload = {
          systemId: String(serverContext.systemId || "shopware-pdp"),
          name: `Shopware PDP ${new Date().toISOString()}`,
          ...buildPayload(),
          cartTransfer: {
            cart_items: [
              {
                product_id: productId,
                product_number: productNumber || undefined,
                quantity,
              },
            ],
            customer_id: serverContext.customerId || undefined,
            sales_channel_id: serverContext.salesChannelId || undefined,
            create_offer: state.customerGroup !== "b2c",
          },
        };

        state.isTransferLoading = true;
        state.transferError = null;
        try {
          const result = await callEndpoint("adapter/submit-transfer", payload, new AbortController());
          state.transferResult = result?.transfer ?? null;
          if (result?.transfer?.status === "blocked") {
            state.liveRegionText = texts.transferBlocked;
          } else if (result?.transfer?.status === "prepared") {
            state.liveRegionText = texts.transferReady;
          } else {
            state.liveRegionText = texts.liveRegionReady;
          }
        } catch (error) {
          state.transferError = error.message || `${texts.transferFailedPrefix} unknown`;
          state.transferResult = null;
          state.liveRegionText = texts.liveRegionError;
        } finally {
          state.isTransferLoading = false;
        }
      }

      function scheduleLiveChecks() {
        if (debounceTimer) window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
          runLiveChecks();
        }, debounceMs);
      }

      function setNumber(key, value, min = 1) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return;
        state[key] = Math.max(min, Math.round(parsed));
        scheduleLiveChecks();
      }

      function setFrameNumber(key, value, min = 1) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return;
        state.frame[key] = Math.max(min, Math.round(parsed));
        scheduleLiveChecks();
      }

      function setCustomerGroup(value) {
        state.customerGroup = normalizeCustomerGroup(value);
        scheduleLiveChecks();
      }

      function setAnchoringIncluded(value) {
        state.frame.anchoringIncluded = Boolean(value);
        scheduleLiveChecks();
      }

      onBeforeUnmount(() => {
        if (debounceTimer) window.clearTimeout(debounceTimer);
        validateAbortController?.abort();
        priceAbortController?.abort();
      });

      scheduleLiveChecks();

      return () =>
        h("section", { class: "meta-clip-cpq", "aria-label": texts.title }, [
          h("header", { class: "meta-clip-cpq__header" }, [
            h("h3", { class: "meta-clip-cpq__title" }, texts.title),
            h("p", { class: "meta-clip-cpq__subtitle" }, texts.subtitle),
          ]),
          h("div", { class: "meta-clip-cpq__grid" }, [
            h("label", { class: "meta-clip-cpq__field" }, [
              h("span", texts.customerGroupLabel),
              h(
                "select",
                {
                  class: "meta-clip-cpq__input",
                  value: state.customerGroup,
                  onInput: (event) => setCustomerGroup(event.target.value),
                },
                [
                  h("option", { value: "b2c" }, texts.customerGroupB2c),
                  h("option", { value: "b2b_standard" }, texts.customerGroupB2bStandard),
                  h("option", { value: "b2b_industrie" }, texts.customerGroupB2bIndustrie),
                ]
              ),
            ]),
            h("label", { class: "meta-clip-cpq__field" }, [
              h("span", texts.heightLabel),
              h("input", {
                class: "meta-clip-cpq__input",
                type: "number",
                min: 500,
                step: 50,
                value: state.frame.heightMm,
                onInput: (event) => setFrameNumber("heightMm", event.target.value, 500),
              }),
            ]),
            h("label", { class: "meta-clip-cpq__field" }, [
              h("span", texts.depthLabel),
              h("input", {
                class: "meta-clip-cpq__input",
                type: "number",
                min: 200,
                step: 50,
                value: state.frame.depthMm,
                onInput: (event) => setFrameNumber("depthMm", event.target.value, 200),
              }),
            ]),
            h("label", { class: "meta-clip-cpq__field" }, [
              h("span", texts.widthLabel),
              h("input", {
                class: "meta-clip-cpq__input",
                type: "number",
                min: 400,
                step: 50,
                value: state.frame.widthMm,
                onInput: (event) => setFrameNumber("widthMm", event.target.value, 400),
              }),
            ]),
            h("label", { class: "meta-clip-cpq__field" }, [
              h("span", texts.shelfCountLabel),
              h("input", {
                class: "meta-clip-cpq__input",
                type: "number",
                min: 1,
                max: 20,
                value: state.shelfCount,
                onInput: (event) => setNumber("shelfCount", event.target.value, 1),
              }),
            ]),
            h("label", { class: "meta-clip-cpq__field" }, [
              h("span", texts.shelfLoadLabel),
              h("input", {
                class: "meta-clip-cpq__input",
                type: "number",
                min: 10,
                step: 10,
                value: state.shelfLoadKg,
                onInput: (event) => setNumber("shelfLoadKg", event.target.value, 10),
              }),
            ]),
          ]),
          h("label", { class: "meta-clip-cpq__checkbox" }, [
            h("input", {
              type: "checkbox",
              checked: state.frame.anchoringIncluded,
              onInput: (event) => setAnchoringIncluded(event.target.checked),
            }),
            h("span", texts.anchoringLabel),
          ]),
          isLoading.value
            ? h(
                "p",
                { class: "meta-clip-cpq__loading", role: "status", "aria-live": "polite" },
                texts.loading
              )
            : null,
          state.requestError
            ? h("div", { class: "meta-clip-cpq__error", role: "alert" }, [
                h("strong", `${texts.requestErrorPrefix} `),
                h("span", state.requestError),
                h(
                  "button",
                  {
                    type: "button",
                    class: "meta-clip-cpq__retry",
                    onClick: () => runLiveChecks(),
                  },
                  texts.retry
                ),
              ])
            : null,
          hasBlockingErrors.value
            ? h("div", { class: "meta-clip-cpq__panel meta-clip-cpq__panel--hard", role: "alert" }, [
                h("h4", texts.hardErrorsTitle),
                h(
                  "ul",
                  state.hardErrors.map((entry, index) =>
                    h("li", { key: `hard-${index}` }, entry)
                  )
                ),
              ])
            : null,
          hasSoftWarnings.value
            ? h("div", { class: "meta-clip-cpq__panel meta-clip-cpq__panel--soft" }, [
                h("h4", texts.softWarningsTitle),
                h(
                  "ul",
                  state.softWarnings.map((entry, index) =>
                    h("li", { key: `soft-${index}` }, entry)
                  )
                ),
              ])
            : null,
          h("div", { class: "meta-clip-cpq__summary" }, [
            h("span", { class: "meta-clip-cpq__badge" }, classBadgeText.value),
            h("span", `${texts.netPrice}: ${state.totals ? formattedNet.value : texts.pricingUnavailable}`),
            h(
              "span",
              `${texts.grossPrice}: ${state.totals ? formattedGross.value : texts.pricingUnavailable}`
            ),
          ]),
          state.customerGroup !== "b2c"
            ? h("p", { class: "meta-clip-cpq__context-note" }, texts.b2bContextNotice)
            : null,
          h("div", { class: "meta-clip-cpq__transfer" }, [
            h(
              "button",
              {
                type: "button",
                class: "meta-clip-cpq__transfer-button",
                disabled: !canTransfer.value,
                onClick: () => submitTransfer(),
              },
              state.isTransferLoading ? texts.transferInProgress : texts.transferButton
            ),
            state.transferError
              ? h("p", { class: "meta-clip-cpq__transfer-error", role: "alert" }, state.transferError)
              : null,
            state.transferResult
              ? h("div", { class: "meta-clip-cpq__transfer-result", role: "status", "aria-live": "polite" }, [
                  h(
                    "p",
                    `${texts.transferStatusLabel}: ${state.transferResult.status}${state.transferResult.reason ? ` (${state.transferResult.reason})` : ""}`
                  ),
                  state.transferResult.status === "blocked"
                    ? h("p", `${texts.reviewGuidanceLabel}: ${state.transferResult.reviewHint || texts.transferBlocked}`)
                    : null,
                ])
              : null,
          ]),
          state.classification === "C"
            ? h("div", { class: "meta-clip-cpq__class-c", role: "status", "aria-live": "polite" }, [
                h("p", texts.classCNotice),
                h(
                  "button",
                  {
                    type: "button",
                    class: "meta-clip-cpq__class-c-button",
                    onClick: (event) => openClassCModal(event),
                  },
                  texts.classCModalTrigger
                ),
              ])
            : null,
          state.lastUpdatedAt
            ? h(
                "p",
                { class: "meta-clip-cpq__updated" },
                `${texts.updatedAtPrefix} ${state.lastUpdatedAt.toLocaleTimeString(locale)}`
              )
            : null,
          h(
            "p",
            {
              class: "meta-clip-cpq__sr-only",
              "aria-live": "polite",
            },
            state.liveRegionText
          ),
          state.classCModalOpen
            ? h("div", {
                class: "meta-clip-cpq__modal-overlay",
                role: "dialog",
                "aria-modal": "true",
                "aria-label": texts.classCModalTitle,
                onKeydown: onModalKeydown,
              }, [
                h("div", { class: "meta-clip-cpq__modal" }, [
                  h("h4", { class: "meta-clip-cpq__modal-title" }, texts.classCModalTitle),
                  h("p", { class: "meta-clip-cpq__modal-text" }, texts.classCModalBody),
                  h(
                    "button",
                    {
                      type: "button",
                      class: "meta-clip-cpq__modal-close",
                      ref: (element) => {
                        closeButtonElement = element;
                      },
                      onClick: closeClassCModal,
                    },
                    texts.close
                  ),
                ]),
              ])
            : null,
        ]);
    },
  });

  app.mount(hostElement);

  return () => {
    app.unmount();
  };
}
