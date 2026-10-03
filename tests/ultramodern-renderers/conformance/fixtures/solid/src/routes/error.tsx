import type { ErrorRouteComponent } from '@bleedingdev/modern-js-renderer-solid/router';

const ErrorBoundary: ErrorRouteComponent = props => (
  <section data-testid="native-error">
    <h1>Native route error</h1>
    <output>{props.error.message}</output>
  </section>
);

export default ErrorBoundary;
