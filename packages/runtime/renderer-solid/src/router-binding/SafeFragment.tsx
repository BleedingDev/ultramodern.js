import type { JSX } from '@solidjs/web';

export function SafeFragment(props: any): JSX.Element {
  return <>{props.children}</>;
}
