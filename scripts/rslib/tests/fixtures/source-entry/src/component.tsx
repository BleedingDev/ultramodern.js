export interface GreetingProps {
  name: string;
}

export function Greeting({ name }: GreetingProps) {
  return { element: 'strong', label: name };
}
