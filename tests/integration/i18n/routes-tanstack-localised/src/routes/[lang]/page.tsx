import { useMatches } from '@modern-js/plugin-tanstack/runtime';
import type { HomeData } from './page.data';

const useCurrentLoaderData = <T,>() => {
  const matches = useMatches() as Array<{ loaderData?: unknown }>;
  return matches[matches.length - 1]?.loaderData as T;
};

export default function HomePage() {
  const data = useCurrentLoaderData<HomeData>();

  return (
    <div id="home">
      home:{data.language}:{data.message}
    </div>
  );
}
