import { Link } from '@modern-js/renderer-octane/router';

export default function About() {
  return (
    <section data-testid="native-about">
      <h1>Native Octane navigation</h1>
      <Link to="/">Home</Link>
    </section>
  );
}
