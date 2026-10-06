import { Link, useMatch } from '@modern-js/plugin-tanstack/runtime';

export default function Item() {
  const data = useMatch({ strict: false }).loaderData;
  return (
    <section data-testid="native-item">
      <pre data-testid="native-item-value">{JSON.stringify(data)}</pre>
      <Link to="/">Home</Link>
    </section>
  );
}
