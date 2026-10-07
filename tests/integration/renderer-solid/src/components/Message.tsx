import type { JSX } from '@solidjs/web';

/** The dev HMR spec rewrites this text; Counter, its sibling, keeps state. */
export default function Message(): JSX.Element {
  return <p data-testid="native-message">Native message</p>;
}
