import { Link, useLoaderData } from '@modern-js/renderer-solid/router';
import type { JSX } from '@solidjs/web';

export default function Item(): JSX.Element {
  const data = useLoaderData({ strict: false });
  return (
    <section data-testid="native-item">
      <pre data-testid="native-item-value">{JSON.stringify(data())}</pre>
      <Link to="/">Home</Link>
    </section>
  );
}
