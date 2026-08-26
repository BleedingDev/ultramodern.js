import originalI18next, { type i18n } from 'i18next';

const i18next: i18n = originalI18next.createInstance();

i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      translation: {
        key: 'Hello World(provider)',
        about: 'About(provider)',
      },
    },
    zh: {
      translation: {
        key: '你好，世界(provider)',
        about: '关于(provider)',
      },
    },
  },
});

export default i18next;
