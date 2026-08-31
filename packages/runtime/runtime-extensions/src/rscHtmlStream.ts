/**
 * Forked and modified from https://github.com/devongovett/rsc-html-stream.
 * License: https://github.com/devongovett/rsc-html-stream/blob/main/LICENSE
 */
const encoder = new TextEncoder();
const closingTagsPattern = /<\/body>\s*<\/html>\s*$/i;
const closingTagsPrefixPattern =
  /(?:<\/body>\s*(?:<\/html>\s*|<\/h(?:t(?:m(?:l>?)?)?)?|<\/?|<)?|<\/b(?:o(?:d(?:y>?)?)?)?|<\/?|<[^>]*)$/i;

export const RSC_HTML_CLOSING_TAIL_LIMIT = 8 * 1024;

export function injectRSCPayload(
  rscStream: ReadableStream<Uint8Array>,
  { injectClosingTags = true }: { injectClosingTags?: boolean } = {},
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let retainedTail = '';
  let committedClosingBody = false;
  let committedHtmlClose = false;
  let committedProbe = '';
  let flightPromise: Promise<void> | undefined;

  const startFlight = (
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    if (!flightPromise) {
      flightPromise = writeRSCStream(rscStream, controller);
      void flightPromise.catch(error => controller.error(error));
    }
    return flightPromise;
  };

  const enqueueHtml = (
    value: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    if (value) {
      controller.enqueue(encoder.encode(value));
    }
  };

  const processHtml = async (
    value: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    if (!value) {
      return;
    }

    if (committedClosingBody) {
      const probe = committedProbe + value;
      committedHtmlClose ||= /<\/html>/i.test(probe);
      committedProbe = probe.slice(-6);
      enqueueHtml(value, controller);
      return;
    }

    const html = retainedTail + value;
    retainedTail = '';
    const suffix = html.match(closingTagsPrefixPattern)?.[0] ?? '';
    const prefix = suffix ? html.slice(0, -suffix.length) : html;
    enqueueHtml(prefix, controller);

    if (!suffix) {
      void startFlight(controller);
      return;
    }
    if (suffix.length <= RSC_HTML_CLOSING_TAIL_LIMIT) {
      retainedTail = suffix;
      return;
    }

    await startFlight(controller);
    if (/<\/body>/i.test(suffix)) {
      committedClosingBody = true;
      committedHtmlClose = /<\/html>/i.test(suffix);
      committedProbe = suffix.slice(-6);
    }
    enqueueHtml(suffix, controller);
  };

  return new TransformStream({
    async transform(chunk, controller) {
      await processHtml(decoder.decode(chunk, { stream: true }), controller);
    },
    async flush(controller) {
      await processHtml(decoder.decode(), controller);
      await startFlight(controller);

      const retainedClosingTags = closingTagsPattern.test(retainedTail);
      enqueueHtml(retainedTail, controller);
      if (!injectClosingTags) {
        return;
      }
      if (committedClosingBody) {
        if (!committedHtmlClose) {
          enqueueHtml('</html>', controller);
        }
      } else if (!retainedClosingTags) {
        enqueueHtml('</body></html>', controller);
      }
    },
  });
}

async function writeRSCStream(
  rscStream: ReadableStream<Uint8Array>,
  controller: TransformStreamDefaultController<Uint8Array>,
): Promise<void> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const chunk of rscStream) {
    try {
      writeChunk(
        JSON.stringify(decoder.decode(chunk, { stream: true })),
        controller,
      );
    } catch {
      const base64 = JSON.stringify(btoa(String.fromCodePoint(...chunk)));
      writeChunk(
        `Uint8Array.from(atob(${base64}), m => m.codePointAt(0))`,
        controller,
      );
    }
  }

  const remaining = decoder.decode();
  if (remaining) {
    writeChunk(JSON.stringify(remaining), controller);
  }
}

function writeChunk(
  chunk: string,
  controller: TransformStreamDefaultController<Uint8Array>,
) {
  const script = `(self.__FLIGHT_DATA||=[]).push(${chunk})`;
  controller.enqueue(
    encoder.encode(
      `<script>${script.replace(/<!--/g, '<\\!--').replace(/<\/(script)/gi, '</\\$1')}</script>`,
    ),
  );
}
