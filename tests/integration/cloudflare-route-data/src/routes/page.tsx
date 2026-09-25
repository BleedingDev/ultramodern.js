import { useMatch } from '@modern-js/plugin-tanstack/runtime';

export default function IndexPage() {
  const match = useMatch({ from: '/' });

  return <div id="index">worker-index:{match.loaderData!.page}</div>;
}
