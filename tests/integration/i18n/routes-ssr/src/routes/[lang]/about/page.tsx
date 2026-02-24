import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default () => {
  const { i18nInstance } = useModernI18n();
  return <div id="about">{i18nInstance.t('about')}</div>;
};
