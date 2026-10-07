import { Link } from '@modern-js/plugin-tanstack/runtime';
import { Helmet } from '@modern-js/runtime/head';
import './page.css';

export default function About() {
  return (
    <section className="native-about-route" data-testid="native-about">
      <Helmet>
        <title>react fixture about</title>
        <meta name="description" content="Renderer fixture" />
      </Helmet>
      <h1>Native React navigation</h1>
      <Link to="/">Home</Link>
    </section>
  );
}
