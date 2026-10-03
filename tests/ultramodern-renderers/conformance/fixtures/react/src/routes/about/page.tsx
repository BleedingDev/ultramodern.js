import { Link } from '@bleedingdev/modern-js-plugin-tanstack/runtime';
import { Helmet } from '@bleedingdev/modern-js-runtime/head';

export default function About() {
  return (
    <section data-testid="native-about">
      <Helmet>
        <title>react acceptance about</title>
        <meta name="description" content="Native renderer conformance" />
      </Helmet>
      <h1>Native React navigation</h1>
      <Link to="/">Home</Link>
    </section>
  );
}
