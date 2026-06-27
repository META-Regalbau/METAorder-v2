export const selectors = {
  login: {
    username: "[data-testid='input-username']",
    password: "[data-testid='input-password']",
    submit: "[data-testid='button-login']",
  },
  nav: {
    configurator: "[data-testid='link-nav-configurator']",
    offers: "[data-testid='link-nav-offers']",
  },
  cpq: {
    heading: "[data-testid='heading-cpq-configurator']",
    nextStep: "[data-testid='cpq-button-next-step']",
    saveConfiguration: "[data-testid='cpq-button-save-configuration']",
    createOfferDraft: "[data-testid='cpq-button-create-offer-draft']",
    validateCore: "[data-testid='cpq-button-validate-core']",
    priceCore: "[data-testid='cpq-button-price-core']",
  },
  offers: {
    heading: "[data-testid='heading-offers-page']",
  },
};
