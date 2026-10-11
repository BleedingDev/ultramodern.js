import { renderToStream } from '@solidjs/web';
import { createMemo, Loading, onCleanup } from 'solid-js';
export async function probeStreaming() {
  let resolve,
    rootCleanup = 0;
  const source = new Promise(r => (resolve = r));
  let firstFlush;
  const first = new Promise(r => (firstFlush = r));
  let finish;
  const complete = new Promise(r => (finish = r));
  const writes = [];
  function Message() {
    const value = createMemo(() => source);
    return <p id="resolved">{value()}</p>;
  }
  function View() {
    onCleanup(() => rootCleanup++);
    return (
      <main>
        <h1>Early shell</h1>
        <Loading fallback={<p id="pending">Pending data</p>}>
          <Message />
        </Loading>
      </main>
    );
  }
  const stream = renderToStream(View, { renderId: 'stream' });
  stream.pipe({
    write(x) {
      writes.push(x);
      firstFlush();
    },
    end() {
      finish();
    },
  });
  await first;
  const early = writes.join('');
  resolve('Resolved later');
  await complete;
  if (!early.includes('Pending data') || early.includes('Resolved later'))
    throw new Error('Stream did not flush early shell');
  if (!writes.join('').includes('Resolved later') || rootCleanup !== 1)
    throw new Error('Stream did not finish and cleanup exactly once');
  let lateResolve,
    abortedCleanup = 0;
  const late = new Promise(r => (lateResolve = r));
  const controller = new AbortController();
  const abandonedWrites = [];
  let abandonFlush;
  const abandonedFirst = new Promise(r => (abandonFlush = r));
  function Abandoned() {
    onCleanup(() => abortedCleanup++);
    const value = createMemo(() => late);
    return (
      <Loading fallback={<p>Abort pending</p>}>
        <p>{value()}</p>
      </Loading>
    );
  }
  const abandoned = renderToStream(Abandoned, { signal: controller.signal });
  abandoned.pipe({
    write(x) {
      abandonedWrites.push(x);
      abandonFlush();
    },
    end() {},
  });
  await abandonedFirst;
  controller.abort();
  await new Promise(r => setTimeout(r, 0));
  const before = abandonedWrites.length;
  lateResolve('Must never emit');
  await new Promise(r => setTimeout(r, 10));
  if (abortedCleanup !== 1 || abandonedWrites.length !== before)
    throw new Error('Aborted render leaked cleanup or late bytes');
  return {
    earlyShell: true,
    completeCleanup: rootCleanup,
    abortCleanup: abortedCleanup,
    lateWrites: abandonedWrites.length - before,
  };
}
