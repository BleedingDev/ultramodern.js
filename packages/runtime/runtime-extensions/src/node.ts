import { pipeline, Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { abortHeadRender, createHeadChunkProcessor } from './rendererHead';

export * from './rendererHead';

const toError = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error(String(reason));

export const createNodeHeadMarkerStripper = (
  context: object,
  terminalMarker?: string,
): Transform => {
  const decoder = new StringDecoder('utf8');
  const processor = createHeadChunkProcessor(context);
  let terminalCarry = '';
  let sawTerminalMarker = terminalMarker === undefined;
  const observeTerminalMarker = (output: string): string => {
    if (!sawTerminalMarker && terminalMarker !== undefined) {
      const observed = terminalCarry + output;
      sawTerminalMarker = observed.includes(terminalMarker);
      terminalCarry = observed.slice(
        Math.max(0, observed.length - terminalMarker.length + 1),
      );
    }
    return output;
  };
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        callback(
          null,
          observeTerminalMarker(
            processor.push(
              decoder.write(
                Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
              ),
            ),
          ),
        );
      } catch (error) {
        callback(toError(error));
      }
    },
    flush(callback) {
      try {
        const output = observeTerminalMarker(processor.finish(decoder.end()));
        callback(
          null,
          sawTerminalMarker ? output : `${output}${terminalMarker}`,
        );
      } catch (error) {
        callback(toError(error));
      }
    },
    destroy(error, callback) {
      try {
        abortHeadRender(context);
        callback(error);
      } catch (abortError) {
        callback(error ?? toError(abortError));
      }
    },
  });
};

export const createOnceErrorReporter = (
  onError?: (error: unknown) => void,
): ((error: unknown) => void) => {
  let reported = false;
  return error => {
    if (!reported) {
      reported = true;
      onError?.(error);
    }
  };
};

export const pipeNodeHeadStream = (options: {
  source: NodeJS.ReadWriteStream;
  destination: NodeJS.ReadWriteStream;
  context: object;
  terminalMarker?: string;
  onError?: (error: Error) => void;
}): void => {
  const { source, destination, context, terminalMarker, onError } = options;
  const stripper = createNodeHeadMarkerStripper(context, terminalMarker);
  pipeline(source, stripper, destination, error => {
    if (error !== null) {
      onError?.(error);
    }
  });
};
