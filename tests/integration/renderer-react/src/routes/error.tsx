import { Helmet } from '@modern-js/runtime/head';

export default function RouteError() {
  return (
    <section data-testid="native-error" data-renderer="react">
      <Helmet>
        <title>react fixture error</title>
      </Helmet>
      <h1>Native route error</h1>
    </section>
  );
}
