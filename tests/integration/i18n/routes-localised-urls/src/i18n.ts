import originalI18next from 'i18next';

const i18next = originalI18next.createInstance();

i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      translation: {
        about: 'About',
        products: 'Products',
        product: 'Product',
      },
    },
    cs: {
      translation: {
        about: 'O nas',
        products: 'Produkty',
        product: 'Produkt',
      },
    },
  },
});

export default i18next;
