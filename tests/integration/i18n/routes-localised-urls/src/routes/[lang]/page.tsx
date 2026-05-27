import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default function HomePage() {
  const { language } = useModernI18n();

  return (
    <section>
      <h1 id="home-heading">Home</h1>
      <p id="home-language">{language}</p>
    </section>
  );
}
