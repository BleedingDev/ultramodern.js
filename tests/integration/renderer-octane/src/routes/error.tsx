import type { ErrorRouteComponent } from '@modern-js/renderer-octane/router';

const ErrorBoundary: ErrorRouteComponent = props => (
  <section data-testid="native-error">
    <h1>Native route error</h1>
    <output>
      {props.error instanceof Error ? props.error.message : String(props.error)}
    </output>
  </section>
);

export default ErrorBoundary;
