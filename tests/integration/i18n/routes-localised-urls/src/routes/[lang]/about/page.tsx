import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default function AboutPage() {
  const { language, t } = useModernI18n();

  return (
    <section>
      <h1 id="about-heading">{t('about')}</h1>
      <p id="about-language">{language}</p>
    </section>
  );
}
