function disabledRscClient(): never {
  throw new Error('React Server Components are disabled for this build.');
}

export const createFromFetch = disabledRscClient;
export const createFromReadableStream = disabledRscClient;
export const createServerReference = disabledRscClient;
export const createTemporaryReferenceSet = disabledRscClient;
export const encodeReply = disabledRscClient;
export const setServerCallback = disabledRscClient;
