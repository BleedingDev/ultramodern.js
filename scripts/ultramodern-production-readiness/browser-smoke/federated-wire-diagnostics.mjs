// Acceptance-only transport evidence; the application receives the original response.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function bundleUrl(input) {
  try {
    const url = new URL(input instanceof Request ? input.url : input);
    return ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      /^\/bundles\/[^/]+\.js$/u.test(url.pathname)
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

export function withFederatedWireDiagnostics(
  fetch,
  directory,
  {
    maxResponses = 64,
    maxResponseBytes = 4 * 1024 * 1024,
    maxTotalBytes = 64 * 1024 * 1024,
  } = {},
) {
  let responses = 0;
  let recordedBytes = 0;
  async function readBody(copy) {
    const reader = copy.body?.getReader();
    if (!reader) return { bytes: Buffer.alloc(0), truncated: false };
    const chunks = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { bytes: Buffer.concat(chunks), truncated: false };
        const available = Math.max(
          0,
          Math.min(maxResponseBytes - length, maxTotalBytes - recordedBytes),
        );
        const captured = Math.min(available, value.byteLength);
        chunks.push(Buffer.from(value.subarray(0, captured)));
        length += captured;
        recordedBytes += captured;
        if (captured !== value.byteLength) {
          void reader.cancel().catch(() => {});
          return { bytes: Buffer.concat(chunks), truncated: true };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  return async function diagnosticFetch(...args) {
    const response = await fetch.apply(this, args);
    const url = bundleUrl(args[0]);
    if (url) {
      if (responses >= maxResponses || recordedBytes >= maxTotalBytes) {
        console.error(
          `Federated wire diagnostic skipped (capture budget): ${url.href}`,
        );
        return response;
      }
      const sequence = ++responses;
      let copy;
      try {
        copy = response.clone();
      } catch (error) {
        console.error('Federated wire diagnostic recording failed:', error);
        return response;
      }
      void readBody(copy)
        .then(async ({ bytes, truncated }) => {
          const key = `${sequence}-${createHash('sha256').update(url.href).digest('hex')}`;
          const decodedBodyFile = `${key}.body.log`;
          await fs.mkdir(directory, { recursive: true });
          await fs.writeFile(path.join(directory, decodedBodyFile), bytes);
          await fs.writeFile(
            path.join(directory, `${key}.json`),
            JSON.stringify(
              {
                url: url.href,
                status: response.status,
                headers: Object.fromEntries(
                  ['content-type', 'content-encoding', 'content-length'].map(
                    name => [name, response.headers.get(name)],
                  ),
                ),
                truncated,
                byteLength: bytes.byteLength,
                sha256: createHash('sha256').update(bytes).digest('hex'),
                decodedBodyFile,
              },
              null,
              2,
            ),
          );
        })
        .catch(error =>
          console.error('Federated wire diagnostic recording failed:', error),
        );
    }
    return response;
  };
}

if (
  process.env.FEDERATION_DEBUG === 'true' &&
  process.env.ULTRAMODERN_FEDERATED_WIRE_DIR
) {
  globalThis.fetch = withFederatedWireDiagnostics(
    globalThis.fetch,
    process.env.ULTRAMODERN_FEDERATED_WIRE_DIR,
  );
}
