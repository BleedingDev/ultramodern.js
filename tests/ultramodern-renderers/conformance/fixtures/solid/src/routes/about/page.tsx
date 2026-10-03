import { Link } from '@bleedingdev/modern-js-renderer-solid/router';
import type { JSX } from '@solidjs/web';

export default function About(): JSX.Element {
  return (
    <section data-testid="native-about">
      <h1>Native Solid navigation</h1>
      <Link to="/">Home</Link>
    </section>
  );
}
