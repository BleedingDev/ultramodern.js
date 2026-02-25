export type EventContract<Name extends string = string, Payload = unknown> = {
  name: Name;
  version: number;
  schemaHash: string;
  description?: string;
};

export type EventEnvelope<
  TContract extends EventContract = EventContract,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> = {
  name: TContract['name'];
  version: TContract['version'];
  schemaHash: TContract['schemaHash'];
  timestamp: number;
  payload: TContract extends EventContract<string, infer TPayload>
    ? TPayload
    : unknown;
  meta?: TMeta;
};

export const defineEventContract = <
  Name extends string,
  Payload = unknown,
>(input: {
  name: Name;
  version: number;
  schemaHash: string;
  description?: string;
}): EventContract<Name, Payload> => {
  const normalizedName = input.name.trim();
  if (!normalizedName) {
    throw new Error('Event contract name must be non-empty');
  }
  if (!Number.isFinite(input.version) || input.version <= 0) {
    throw new Error('Event contract version must be a positive number');
  }
  if (!input.schemaHash || !input.schemaHash.trim()) {
    throw new Error('Event contract schemaHash must be non-empty');
  }

  return {
    name: normalizedName as Name,
    version: Math.floor(input.version),
    schemaHash: input.schemaHash.trim(),
    description: input.description,
  };
};

export const createEventEnvelope = <
  TContract extends EventContract,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
>(
  contract: TContract,
  payload: TContract extends EventContract<string, infer TPayload>
    ? TPayload
    : unknown,
  meta?: TMeta,
): EventEnvelope<TContract, TMeta> => ({
  name: contract.name,
  version: contract.version,
  schemaHash: contract.schemaHash,
  timestamp: Date.now(),
  payload,
  ...(meta ? { meta } : {}),
});

export const isEventEnvelope = (
  value: unknown,
): value is EventEnvelope<EventContract, Record<string, unknown>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.version === 'number' &&
    candidate.version > 0 &&
    typeof candidate.schemaHash === 'string' &&
    candidate.schemaHash.length > 0 &&
    typeof candidate.timestamp === 'number' &&
    Number.isFinite(candidate.timestamp) &&
    'payload' in candidate
  );
};
