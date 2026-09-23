import { Schema } from 'effect';

const MicroVerticalAppIdSchema = Schema.String.pipe(
  Schema.brand('MicroVerticalAppId'),
  Schema.decodeTo(Schema.String),
);
const MicroVerticalUnitIdSchema = Schema.String.pipe(
  Schema.brand('MicroVerticalUnitId'),
  Schema.decodeTo(Schema.String),
);
const MicroVerticalOperationIdSchema = Schema.String.pipe(
  Schema.brand('MicroVerticalOperationId'),
  Schema.decodeTo(Schema.String),
);
const MicroVerticalTraceIdSchema = Schema.String.pipe(
  Schema.brand('MicroVerticalTraceId'),
  Schema.decodeTo(Schema.String),
);

export const MicroVerticalBuildMarkerSchema = Schema.Struct({
  appId: MicroVerticalAppIdSchema,
  build: Schema.String,
  buildMarker: Schema.String,
  deployProfile: Schema.String,
  packageName: Schema.String,
  sourceRevision: Schema.String,
  surface: Schema.String,
  unitId: MicroVerticalUnitIdSchema,
  version: Schema.String,
});
export type MicroVerticalBuildMarker =
  typeof MicroVerticalBuildMarkerSchema.Type;

export const MicroVerticalReadinessSchema = Schema.Struct({
  checks: Schema.Struct({
    api: Schema.Literal('ready'),
    moduleFederation: Schema.Literal('ready'),
    ssr: Schema.Literal('ready'),
    translations: Schema.Literal('ready'),
  }),
  marker: MicroVerticalBuildMarkerSchema,
  status: Schema.Literal('ready'),
  versionSkew: Schema.Literal('none'),
});
export type MicroVerticalReadiness = typeof MicroVerticalReadinessSchema.Type;

export const MicroVerticalOperationSourceSchema = Schema.Literals([
  'client',
  'server',
  'generated-client',
  'effect-server',
  'data-platform',
  'unknown',
]);
export type MicroVerticalOperationSource =
  typeof MicroVerticalOperationSourceSchema.Type;

export const MicroVerticalOperationContextSchema = Schema.Struct({
  method: Schema.String,
  operationId: MicroVerticalOperationIdSchema,
  routePath: Schema.String,
  source: MicroVerticalOperationSourceSchema,
  traceId: Schema.optionalKey(MicroVerticalTraceIdSchema),
});
export type MicroVerticalOperationContext =
  typeof MicroVerticalOperationContextSchema.Type;

export const createMicroVerticalOperationContext = <
  const Method extends string,
  const OperationId extends string,
  const RoutePath extends string,
>(input: {
  readonly method: Method;
  readonly operationId: OperationId;
  readonly routePath: RoutePath;
  // eslint-disable-next-line effect-native/no-threaded-correlation-parameter -- This pure browser-safe contract deliberately carries optional trace metadata; it does not perform ambient request work.
  readonly traceId?: string;
}): Readonly<typeof input & { source: 'generated-client' }> => {
  const context = {
    method: input.method,
    operationId: input.operationId,
    routePath: input.routePath,
    source: 'generated-client' as const,
  };
  return input.traceId === undefined
    ? context
    : { ...context, traceId: input.traceId };
};

export const microVerticalOperationAttributes = (
  operationContext: MicroVerticalOperationContext,
) => {
  const attributes = {
    'modernjs.operation.id': operationContext.operationId,
    'modernjs.operation.method': operationContext.method,
    'modernjs.operation.route': operationContext.routePath,
    'modernjs.operation.source': operationContext.source,
  };
  return operationContext.traceId === undefined
    ? attributes
    : { ...attributes, 'modernjs.trace.id': operationContext.traceId };
};
