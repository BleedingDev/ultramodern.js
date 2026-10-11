import { Link, useLoaderData } from '@modern-js/renderer-octane/router';

export default function Item() {
  const data = useLoaderData({ strict: false });
  return (
    <section data-testid="native-item">
      <pre data-testid="native-item-value">{JSON.stringify(data)}</pre>
      <Link to="/">Home</Link>
    </section>
  );
}
