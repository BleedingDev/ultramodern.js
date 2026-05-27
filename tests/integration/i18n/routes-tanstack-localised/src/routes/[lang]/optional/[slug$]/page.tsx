import { useMatches } from '@modern-js/plugin-tanstack/runtime';
import type { OptionalData } from './page.data';

const useCurrentLoaderData = <T,>() => {
  const matches = useMatches() as Array<{ loaderData?: unknown }>;
  return matches[matches.length - 1]?.loaderData as T;
};

export default function OptionalPage() {
  const data = useCurrentLoaderData<OptionalData>();

  return (
    <div id="optional">
      optional:{data.language}:{data.slug}
    </div>
  );
}
