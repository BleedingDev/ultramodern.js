import { lazy, Suspense } from 'react';

const DelayedContent = lazy(async () => {
  await new Promise(resolve => setTimeout(resolve, 1200));
  return {
    default: () => <p id="stream-complete">Native stream completed</p>,
  };
});

export default function Stream() {
  return (
    <Suspense fallback={<p id="stream-fallback">Waiting for native stream</p>}>
      <DelayedContent />
    </Suspense>
  );
}
