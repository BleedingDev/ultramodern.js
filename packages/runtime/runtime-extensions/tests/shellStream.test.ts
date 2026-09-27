import {
  beginHeadRender,
  collectHeadRecord,
  completeHeadRender,
  createConservingWebShellStream,
} from '../src';

const MARKER = '&lt;!--&lt;?- SHELL_STREAM_END ?&gt;--&gt;';
const encoder = new TextEncoder();
const headMarker = (props: Record<string, string>) =>
  `<template data-modern-helmet="${props['data-modern-helmet']}"></template>`;

const streamFromChunks = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

const splitAt = (value: Uint8Array, offsets: number[]) => {
  const chunks: Uint8Array[] = [];
  let cursor = 0;
  for (const offset of offsets) {
    chunks.push(value.slice(cursor, offset));
    cursor = offset;
  }
  chunks.push(value.slice(cursor));
  return chunks;
};

describe('conserving web shell stream', () => {
  it('preserves a large multichunk shell and tail across UTF-8 splits', async () => {
    const shell = `α${'s'.repeat(9 * 1024)}`;
    const tail = `尾${'t'.repeat(9 * 1024)}🌐done`;
    const html = `${shell}${MARKER}${tail}`;
    const bytes = encoder.encode(html);
    const markerStart = encoder.encode(shell).length;
    const markerEnd = markerStart + encoder.encode(MARKER).length;
    const chunks = splitAt(bytes, [
      1,
      8192,
      markerStart + 7,
      markerEnd - 3,
      markerEnd + 1,
      bytes.length - 2,
    ]);

    const output = await new Response(
      createConservingWebShellStream(streamFromChunks(chunks), {}, MARKER),
    ).text();

    expect(output).toBe(html);
  });

  it('reports once and errors when the source closes without a marker', async () => {
    const onMissingMarker = rstest.fn();
    const context = {};
    let published: string[] = [];
    const publish = (records: string[]) => {
      published = records;
    };
    beginHeadRender(context, () => {});
    const previous = collectHeadRecord(context, () => 'previous', publish)!;
    completeHeadRender(context, headMarker(previous));
    beginHeadRender(context, () => {});
    collectHeadRecord(context, () => 'incomplete', publish);
    const bytes = encoder.encode(`α${'x'.repeat(9 * 1024)}尾`);
    const stream = createConservingWebShellStream(
      streamFromChunks(splitAt(bytes, [1, 8192, bytes.length - 1])),
      context,
      MARKER,
      onMissingMarker,
    );

    await expect(new Response(stream).text()).rejects.toThrow(
      'React SSR stream ended before the shell marker',
    );
    expect(onMissingMarker).toHaveBeenCalledTimes(1);
    expect(onMissingMarker).toHaveBeenCalledWith(expect.any(Error));
    expect(published).toEqual(['previous']);
  });
});

test('cancellation waits for the owned source cancellation to finish once', async () => {
  let release!: () => void;
  let started!: () => void;
  const cancelling = new Promise<void>(resolve => {
    started = resolve;
  });
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const cancel = rstest.fn(async () => {
    started();
    await gate;
  });
  const source = new ReadableStream<Uint8Array>({ cancel });
  const reader = createConservingWebShellStream(source, {}, MARKER).getReader();
  let settled = false;
  const cancellation = reader.cancel('stop').then(() => {
    settled = true;
  });
  await cancelling;
  expect(settled).toBe(false);
  release();
  await cancellation;
  expect(cancel).toHaveBeenCalledExactlyOnceWith('stop');
});

test('cancellation propagates an owned source cleanup failure', async () => {
  const source = new ReadableStream<Uint8Array>({
    cancel() {
      throw new Error('cleanup failed');
    },
  });
  await expect(
    createConservingWebShellStream(source, {}, MARKER).cancel('stop'),
  ).rejects.toThrow('cleanup failed');
});
