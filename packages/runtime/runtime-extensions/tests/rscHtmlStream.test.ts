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

  test('does not let flight overtake an ordinary partial html tag', async () => {
    const rscStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('payload'));
        controller.close();
      },
    });
    const transform = injectRSCPayload(rscStream);
    const output = readStream(transform.readable);
    const writer = transform.writable.getWriter();

    await writer.write(encoder.encode('<body>x<'));
    await writer.write(encoder.encode('span>y</span></body></html>'));
    await writer.close();

    expect(await output).toBe(`<body>x<span>y</span>${flight}</body></html>`);
  });
});
