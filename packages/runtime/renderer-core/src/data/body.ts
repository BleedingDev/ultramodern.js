import { DataProtocolError, MAX_DATA_BYTES } from './codec';

/** Bound actual bytes while reading, rather than buffering an arbitrary body. */
export async function readBoundedDataText(
  response: Response,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      const result = await reader.read();
      signal?.throwIfAborted();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_DATA_BYTES) {
        throw new DataProtocolError('Public data exceeds its byte limit');
      }
      text += decoder.decode(result.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}
