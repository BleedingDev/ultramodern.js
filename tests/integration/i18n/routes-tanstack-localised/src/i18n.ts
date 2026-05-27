import originalI18next from 'i18next';

const i18next = originalI18next.createInstance();

i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: ['en', 'cs'],
  resources: {
    en: {
      translation: {
        home: 'English home',
        products: 'Products',
        terms: 'Terms of Service',
      },
    },
    cs: {
      translation: {
        home: 'Ceska domovska stranka',
        products: 'Produkty',
        terms: 'Obchodni podminky',
      },
    },
  },
});

export default i18next;
