import { runInNewContext } from 'node:vm';
import { injectCSS, injectRSCPayload } from '../../src/rsc-html-stream/server';

async function readStreamAsText(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function createStreamFromChunks(chunks: string[]) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      controller.close();
    },
  });
}

describe('injectRSCPayload', () => {
  const flight = '<script>(self.__FLIGHT_DATA||=[]).push("payload")</script>';
  const spaces = ' '.repeat(9000);
  test('keeps flight scripts before closing tags when html trailer contains whitespace', async () => {
    const htmlStream = createStreamFromChunks([
      '<body><div>app</div>\n\n</body>\n</html>\n',
    ]);
    const rscStream = createStreamFromChunks(['payload']);

    const text = await readStreamAsText(
      htmlStream.pipeThrough(
        injectRSCPayload(rscStream, {
          injectClosingTags: true,
        }),
      ),
    );

    expect(text.match(/<\/body>/g)).toHaveLength(1);
    expect(text.match(/<\/html>/g)).toHaveLength(1);
    expect(
      text.lastIndexOf('<script>(self.__FLIGHT_DATA||=[]).push('),
    ).toBeLessThan(text.lastIndexOf('</body>'));
    expect(
      text.lastIndexOf('<script>(self.__FLIGHT_DATA||=[]).push('),
    ).toBeLessThan(text.lastIndexOf('</html>'));
    expect(text.trimEnd().endsWith('</html>')).toBe(true);
  });

  test('does not duplicate closing tags when html trailer is split across chunks', async () => {
    const htmlStream = createStreamFromChunks([
      '<body><div>app</div></bo',
      `dy>${spaces}</html>`,
    ]);
    const rscStream = createStreamFromChunks(['payload']);

    const text = await readStreamAsText(
      htmlStream.pipeThrough(
        injectRSCPayload(rscStream, {
          injectClosingTags: true,
        }),
      ),
    );

    expect(text).toBe(`<body><div>app</div>${flight}</body>${spaces}</html>`);
    expect(text.match(/<\/body>/g)).toHaveLength(1);
    expect(text.match(/<\/html>/g)).toHaveLength(1);
    expect(
      text.lastIndexOf('<script>(self.__FLIGHT_DATA||=[]).push('),
    ).toBeLessThan(text.lastIndexOf('</body>'));
    expect(text.endsWith('</html>')).toBe(true);
  });

  test('streams flight data when html is empty', async () => {
    const text = await readStreamAsText(
      createStreamFromChunks([]).pipeThrough(
        injectRSCPayload(createStreamFromChunks(['payload']), {}),
      ),
    );

    expect(text).toBe(`${flight}</body></html>`);
  }, 500);
});

function createByteStream(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function recoverFlightBytes(html: string) {
  const self: { __FLIGHT_DATA?: (string | Uint8Array)[] } = {};
  for (const [, script] of html.matchAll(/<script>(.*?)<\/script>/gs)) {
    runInNewContext(script, { self, atob, Uint8Array });
  }
  return Buffer.concat(
    (self.__FLIGHT_DATA ?? []).map(value => Buffer.from(value)),
  );
}

describe('native stream regressions', () => {
  test.each([true, false])(
    'empty HTML and Flight finish with closing tags=%s',
    async injectClosingTags => {
      const html = await readStreamAsText(
        createByteStream([]).pipeThrough(
          injectRSCPayload(createByteStream([]), { injectClosingTags }),
        ),
      );
      expect(html).toBe(injectClosingTags ? '</body></html>' : '');
    },
  );

  test.each([true, false])(
    'preserves or strips a split original trailer with closing tags=%s',
    async injectClosingTags => {
      const trailer = '</BoDy>\n</HtMl>  ';
      const html = await readStreamAsText(
        createStreamFromChunks([
          '<body>hello</Bo',
          'Dy>\n<',
          '/H',
          't',
          'M',
          'l',
          '>  ',
        ]).pipeThrough(
          injectRSCPayload(createByteStream([]), { injectClosingTags }),
        ),
      );
      expect(html).toBe(`<body>hello${injectClosingTags ? trailer : ''}`);
    },
  );

  test('preserves HTML and Flight bytes split within UTF-8, binary data and script escapes', async () => {
    const encoder = new TextEncoder();
    const flight = Buffer.concat([
      encoder.encode('🦊中文</script><!--'),
      new Uint8Array([0xe2, 0x80, 0xff]),
      new Uint8Array(200000).fill(255),
    ]);
    const html = await readStreamAsText(
      createByteStream(
        [...encoder.encode('<body>🦊中文</body></html>')].map(
          byte => new Uint8Array([byte]),
        ),
      ).pipeThrough(
        injectRSCPayload(
          createByteStream([
            flight.subarray(0, 1),
            flight.subarray(1, 2),
            flight.subarray(2),
          ]),
          {},
        ),
      ),
    );
    expect(html.replace(/<script>.*?<\/script>/gs, '')).toBe(
      '<body>🦊中文</body></html>',
    );
    expect(recoverFlightBytes(html)).toEqual(flight);
  });

  test('preserves a UTF-8 BOM and escapes text Flight scripts', async () => {
    const payload = '\uFEFFtext</ScRiPt><!--';
    const html = await readStreamAsText(
      createByteStream([]).pipeThrough(
        injectRSCPayload(
          createByteStream([new TextEncoder().encode(payload)]),
          {},
        ),
      ),
    );
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<\/script>/gi)).toHaveLength(1);
    expect(recoverFlightBytes(html)).toEqual(Buffer.from(payload));
  });

  test('streams Flight before HTML closes without inserting it inside split tags', async () => {
    const stream = injectRSCPayload(createStreamFromChunks(['payload']), {});
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const write = writer.write(new TextEncoder().encode('<body>ready<div'));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      '<body>ready',
    );
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      '__FLIGHT_DATA',
    );
    await write;
    const remaining = readStreamAsText(
      new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        },
      }),
    );
    await writer.write(
      new TextEncoder().encode('>content</div></body></html>'),
    );
    await writer.close();
    expect(await remaining).toBe('<div>content</div></body></html>');
  });

  test.each(['readable', 'writable'])(
    'cancels pending Flight on %s cancellation',
    async side => {
      let cancelReason: unknown;
      const rsc = new ReadableStream<Uint8Array>({
        cancel(reason) {
          cancelReason = reason;
        },
      });
      const stream = injectRSCPayload(rsc, {});
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();
      const write = writer.write(new TextEncoder().encode('<body>ready'));
      await reader.read();
      await write;
      void writer.closed.catch(() => {});
      void reader.closed.catch(() => {});
      if (side === 'readable') await reader.cancel('stop');
      else await writer.abort('stop');
      expect(cancelReason).toBe('stop');
      expect(rsc.locked).toBe(false);
    },
  );

  test('propagates Flight errors and releases its reader', async () => {
    const failure = new Error('Flight failed');
    const rsc = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    });
    await expect(
      readStreamAsText(
        createByteStream([]).pipeThrough(injectRSCPayload(rsc, {})),
      ),
    ).rejects.toThrow('Flight failed');
    expect(rsc.locked).toBe(false);
  });

  test('cancels Flight when HTML fails', async () => {
    let cancelReason: unknown;
    const rsc = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancelReason = reason;
      },
    });
    const failure = new Error('HTML failed');
    const html = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    });
    await expect(
      readStreamAsText(html.pipeThrough(injectRSCPayload(rsc, {}))),
    ).rejects.toThrow('HTML failed');
    expect(cancelReason).toBe(failure);
  });
});

describe('injectCSS', () => {
  test.each([true, false])(
    'injects once before a split mixed-case head and preserves UTF-8 with closing tags=%s',
    async injectClosingTags => {
      const encoder = new TextEncoder();
      const html = '<html><head><title>🦊中文</title></HeAd><body>app';
      const output = await readStreamAsText(
        createByteStream(
          [...encoder.encode(html)].map(byte => new Uint8Array([byte])),
        ).pipeThrough(injectCSS(['app.css'], { injectClosingTags })),
      );
      expect(output).toBe(
        html.replace(
          '</HeAd>',
          '<link href="app.css" rel="stylesheet" /></HeAd>',
        ) + (injectClosingTags ? '</body></html>' : ''),
      );
    },
  );

  test.each([true, false])(
    'preserves pass-through and fallback behavior with closing tags=%s',
    async injectClosingTags => {
      for (const files of [[], ['app.css']]) {
        const html = await readStreamAsText(
          createStreamFromChunks(['<body>🦊']).pipeThrough(
            injectCSS(files, { injectClosingTags }),
          ),
        );
        expect(html).toBe(
          '<body>🦊' +
            (files.length ? '<link href="app.css" rel="stylesheet" />' : '') +
            (injectClosingTags ? '</body></html>' : ''),
        );
      }
    },
  );
});
