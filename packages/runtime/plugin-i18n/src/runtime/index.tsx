import { createI18nPlugin } from './core';
import { getReactI18nextIntegration } from './i18n/react-i18next';

export * from './core';

export const i18nPlugin = createI18nPlugin(getReactI18nextIntegration);

export default i18nPlugin;
