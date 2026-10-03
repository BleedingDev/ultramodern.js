import { Link } from '@bleedingdev/modern-js-plugin-tanstack/runtime';
import { Helmet } from '@bleedingdev/modern-js-runtime/head';

export default function RouteError() {
  return (
    <section data-testid="native-error" data-renderer="react">
      <Helmet>
        <title>react acceptance error</title>
      </Helmet>
      <h1>Native React route error</h1>
      <Link to="/">Return to native home</Link>
    </section>
  );
}
