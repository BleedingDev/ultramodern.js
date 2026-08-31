import type { GreetingProps } from '@fixture/component';

export function identifySourceEntry(): string {
  return 'typescript-entry';
}

export function echoGreetingProps(props: GreetingProps): GreetingProps {
  return props;
}
