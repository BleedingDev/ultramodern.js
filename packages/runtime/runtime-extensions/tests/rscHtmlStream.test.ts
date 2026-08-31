import {
  injectRSCPayload,
  RSC_HTML_CLOSING_TAIL_LIMIT,
} from '../src/rscHtmlStream';

const encoder = new TextEncoder();
const flight = '<script>(self.__FLIGHT_DATA||=[]).push("payload")</script>';

async function readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let value = '';
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      return value + decoder.decode();
    }
    value += decoder.decode(result.value, { stream: true });
  }
}

describe('injectRSCPayload', () => {
  test('backpressures at the retained-tail limit and conserves the trailer', async () => {
    let rscController!: ReadableStreamDefaultController<Uint8Array>;
    const rscStream = new ReadableStream<Uint8Array>({
      start(controller) {
        rscController = controller;
      },
    });
    const transform = injectRSCPayload(rscStream);
    const output = readStream(transform.readable);
    const writer = transform.writable.getWriter();

    const retainedWhitespace = ' '.repeat(
      RSC_HTML_CLOSING_TAIL_LIMIT - '</body>'.length,
    );
    await writer.write(encoder.encode(`<body>x</body>${retainedWhitespace}`));

    let overflowSettled = false;
    const overflow = writer.write(encoder.encode(' ')).then(() => {
      overflowSettled = true;
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(overflowSettled).toBe(false);

    rscController.enqueue(encoder.encode('payload'));
    rscController.close();
    await overflow;
    await writer.write(encoder.encode('</html>'));
    await writer.close();

    const spaces = `${retainedWhitespace} `;
    expect(await output).toBe(`<body>x${flight}</body>${spaces}</html>`);
  });

  test('does not let flight overtake any split of an ordinary html tag', async () => {
    const tag = '<span class="ordinary">';

    for (let split = 1; split < tag.length; split++) {
      const rscStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('payload'));
          controller.close();
        },
      });
      const transform = injectRSCPayload(rscStream);
      const output = readStream(transform.readable);
      const writer = transform.writable.getWriter();

      await writer.write(encoder.encode(`<body>x${tag.slice(0, split)}`));
      await writer.write(
        encoder.encode(`${tag.slice(split)}y</span></body></html>`),
      );
      await writer.close();

      expect(await output, `split after ${tag.slice(0, split)}`).toBe(
        `<body>x${tag}y</span>${flight}</body></html>`,
      );
    }
  });

  test('conserves multi-chunk html and orders every flight chunk before the trailer', async () => {
    let rscController!: ReadableStreamDefaultController<Uint8Array>;
    const rscStream = new ReadableStream<Uint8Array>({
      start(controller) {
        rscController = controller;
      },
    });
    const transform = injectRSCPayload(rscStream);
    const output = readStream(transform.readable);
    const writer = transform.writable.getWriter();
    const unicode = encoder.encode('–');

    await writer.write(encoder.encode('<html><body><main>first'));
    await writer.write(unicode.slice(0, 1));
    await writer.write(unicode.slice(1));
    await writer.write(encoder.encode('middle</main></bo'));
    await writer.write(encoder.encode('dy></ht'));
    await writer.write(encoder.encode('ml>'));

    rscController.enqueue(encoder.encode('first'));
    rscController.enqueue(encoder.encode('second'));
    rscController.close();
    await writer.close();

    expect(await output).toBe(
      '<html><body><main>first–middle</main>' +
        '<script>(self.__FLIGHT_DATA||=[]).push("first")</script>' +
        '<script>(self.__FLIGHT_DATA||=[]).push("second")</script>' +
        '</body></html>',
    );
  });

  test('does not truncate or inject inside an over-limit ordinary tag', async () => {
    const attribute = 'x'.repeat(RSC_HTML_CLOSING_TAIL_LIMIT);
    const partialTag = `<div data-value="${attribute}"`;
    const rscStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('payload'));
        controller.close();
      },
    });
    const transform = injectRSCPayload(rscStream);
    const output = readStream(transform.readable);
    const writer = transform.writable.getWriter();

    await writer.write(encoder.encode(`<body>x${partialTag}`));
    await writer.write(encoder.encode('>y</div></body></html>'));
    await writer.close();

    expect(await output).toBe(
      `<body>x${flight}${partialTag}>y</div></body></html>`,
    );
  });

  test('propagates flight errors without publishing a synthetic trailer', async () => {
    let rscController!: ReadableStreamDefaultController<Uint8Array>;
    const failure = new Error('flight failed');
    const rscStream = new ReadableStream<Uint8Array>({
      start(controller) {
        rscController = controller;
      },
    });
    const transform = injectRSCPayload(rscStream);
    const output = readStream(transform.readable);
    const writer = transform.writable.getWriter();

    await writer.write(encoder.encode('<body>html</body></html>'));
    rscController.error(failure);

    await expect(Promise.all([writer.close(), output])).rejects.toBe(failure);
  });
});
