import { useMatch } from '@modern-js/plugin-tanstack/runtime';

export default function UserPage() {
  const match = useMatch({ from: '/user/$id' });

  return <div id="user">worker-user:{match.loaderData!.id}</div>;
}
