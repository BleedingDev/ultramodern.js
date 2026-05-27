import { useMatches } from '@modern-js/plugin-tanstack/runtime';
import type { TermsData } from './page.data';

const useCurrentLoaderData = <T,>() => {
  const matches = useMatches() as Array<{ loaderData?: unknown }>;
  return matches[matches.length - 1]?.loaderData as T;
};

export default function TermsPage() {
  const data = useCurrentLoaderData<TermsData>();

  return (
    <div id="terms">
      terms:{data.language}:{data.message}
    </div>
  );
}
