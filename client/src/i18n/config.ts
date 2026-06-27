import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import de from './locales/de.json';
import es from './locales/es.json';

export const resources = {
  en: { translation: en },
  de: { translation: de },
  es: { translation: es },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: localStorage.getItem('language') || 'de',
    fallbackLng: 'de',
    interpolation: {
      escapeValue: false,
    },
  });

function syncDocumentLanguage() {
  if (typeof document === 'undefined') return;
  const lng = (i18n.language || 'de').split('-')[0];
  document.documentElement.lang = lng;
}

syncDocumentLanguage();
i18n.on('languageChanged', syncDocumentLanguage);

export default i18n;
