import { Link } from '@modern-js/renderer-octane/router';
import './page.css';

export default function About() {
  return (
    <section class="native-about-route" data-testid="native-about">
      <h1>Native Octane navigation</h1>
      <Link to="/">Home</Link>
    </section>
  );
}
