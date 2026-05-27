import { useMatch } from '@modern-js/plugin-tanstack/runtime';

export default function OptionalPage() {
  const match = useMatch({ from: '/$lang/volitelne/{-$slug}' });
  const data = match.loaderData!;

  return (
    <div id="optional">
      optional:{data.language}:{data.slug}
    </div>
  );
}
