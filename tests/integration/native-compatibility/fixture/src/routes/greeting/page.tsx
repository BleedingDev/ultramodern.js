import { useLoaderData } from '@modern-js/runtime/router';

export default function Greeting() {
  const { message } = useLoaderData() as { message: string };
  return <p id="greeting">{message}</p>;
}
