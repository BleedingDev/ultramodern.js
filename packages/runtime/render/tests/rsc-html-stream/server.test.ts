import { injectRSCPayload } from '../../src/rsc-html-stream/server';

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
