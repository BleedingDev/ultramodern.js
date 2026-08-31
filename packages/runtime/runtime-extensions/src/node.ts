import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { abortHeadRender, createHeadChunkProcessor } from './rendererHead';

export * from './rendererHead';

export const createNodeHeadMarkerStripper = (context: object): Transform => {
  const decoder = new StringDecoder('utf8');
  const processor = createHeadChunkProcessor(context);
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        callback(
          null,
          processor.push(
            decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
          ),
        );
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
    flush(callback) {
      try {
        callback(null, processor.finish(decoder.end()));
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
    destroy(error, callback) {
      abortHeadRender(context);
      callback(error);
    },
  });
};
