import { Link } from '@modern-js/renderer-solid/router';
import type { JSX } from '@solidjs/web';
import './page.css';

export default function About(): JSX.Element {
  return (
    <section class="native-about-route" data-testid="native-about">
      <h1>Native Solid navigation</h1>
      <Link to="/">Home</Link>
    </section>
  );
}
