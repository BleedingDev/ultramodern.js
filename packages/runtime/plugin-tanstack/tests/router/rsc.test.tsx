import type React from 'react';
import { isValidElement } from 'react';
import { createRscProxy } from '../../src/runtime/rsc/createRscProxy';
import { ReplayableStream } from '../../src/runtime/rsc/ReplayableStream';
import {
  RENDERABLE_RSC,
  RSC_PROXY_PATH,
  SERVER_COMPONENT_STREAM,
  type ServerComponentStream,
} from '../../src/runtime/rsc/symbols';

async function readAll(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: number[] = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(...value);
  }

  return chunks;
}

describe('tanstack rsc runtime helpers', () => {
  test('ReplayableStream creates independent readers from one source', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    const replayable = new ReplayableStream(source);

    await expect(readAll(replayable.createReplayStream())).resolves.toEqual([
      1, 2, 3,
    ]);
    await expect(readAll(replayable.createReplayStream())).resolves.toEqual([
      1, 2, 3,
    ]);
  });

  test('renderable RSC proxies preserve React element behavior and metadata', () => {
    const stream: ServerComponentStream = {
      createReplayStream: () => new ReadableStream<Uint8Array>(),
    };
    const proxy = createRscProxy(() => ({ sidebar: 'ok' }), {
      renderable: true,
      stream,
    }) as React.ReactElement & Record<PropertyKey, unknown>;

    expect(isValidElement(proxy)).toBe(true);
    expect(proxy[SERVER_COMPONENT_STREAM]).toBe(stream);
    expect(proxy[RENDERABLE_RSC]).toBe(true);
    expect(proxy.then).toBeUndefined();
    expect('__SEROVAL_STREAM__' in proxy).toBe(false);
    expect('__SEROVAL_SEQUENCE__' in proxy).toBe(false);
    expect(Symbol.iterator in proxy).toBe(false);

    const sidebar = proxy.sidebar as Record<PropertyKey, unknown>;
    expect(sidebar[RSC_PROXY_PATH]).toEqual(['sidebar']);
  });
});
