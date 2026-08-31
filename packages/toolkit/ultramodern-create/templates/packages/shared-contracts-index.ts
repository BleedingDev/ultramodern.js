export type UltramodernPublicSitemapChangeFrequency =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

export interface UltramodernPublicSitemapEntry {
  /**
   * Params used to expand every localized route pattern, for example
   * { slug: 'platform-story' } for /talks/:slug.
   */
  params: Record<string, string | number | boolean>;
  /**
   * Per-locale overrides when translated URLs use translated params.
   */
  localeParams?: Partial<
    Record<'en' | 'cs', Record<string, string | number | boolean>>
  >;
  draft?: boolean;
  indexable?: boolean;
  lastModified?: string;
  changeFrequency?: UltramodernPublicSitemapChangeFrequency;
  priority?: number;
}

export type UltramodernPerformanceReadinessSignalId =
  | 'bfcache'
  | 'core-web-vitals-rum'
  | 'duplicate-prefetch-warmup'
  | 'cache-policy-sanity'
  | 'save-data-behavior'
  | 'cloudflare-ssr-cache-hints';

export interface UltramodernPerformanceReadinessDiagnosticsConfig {
  /**
   * Default-on. Set to false only for an explicit local or CI fast path.
   */
  enabled?: boolean;
  /**
   * Diagnostics may fail objective generated/framework invariants, or never
   * fail and only emit the deterministic report.
   */
  failOn?: 'framework-invariant' | 'never';
  reportPath?: string;
  signals?: Partial<
    Record<
      UltramodernPerformanceReadinessSignalId,
      {
        enabled?: boolean;
      }
    >
  >;
}

export const ultramodernWorkspaceContract = {
  ownership: 'topology/ownership.json',
  performanceReadiness: {
    defaultOn: true,
    optOut: 'scripts/ultramodern-performance-readiness.config.mjs#enabled=false',
    report:
      '.codex/reports/performance-readiness/ultramodern-performance-readiness.json',
    signals: [
      'bfcache',
      'core-web-vitals-rum',
      'duplicate-prefetch-warmup',
      'cache-policy-sanity',
      'save-data-behavior',
      'cloudflare-ssr-cache-hints',
    ],
  },
  preset: 'presetUltramodern',
  topology: 'topology/reference-topology.json',
} as const;

export type UltramodernWorkspaceLocale = 'en' | 'cs';

export type UltramodernPerformanceReadinessSignalStatus =
  | 'pass'
  | 'warn'
  | 'fail';

export const ultramodernWorkspaceEventNames = {
  navigate: 'ultramodern:navigate',
  performanceSignal: 'ultramodern:performance-signal',
  remoteReady: 'ultramodern:remote-ready',
  routeSettled: 'ultramodern:route-settled',
} as const;

export type UltramodernWorkspaceEventName =
  (typeof ultramodernWorkspaceEventNames)[keyof typeof ultramodernWorkspaceEventNames];

export interface UltramodernNavigatePayload {
  to: string;
  replace?: boolean;
  state?: Record<string, unknown>;
}

export interface UltramodernRouteSettledPayload {
  pathname: string;
  locale?: UltramodernWorkspaceLocale;
  title?: string;
}

export interface UltramodernRemoteReadyPayload {
  appId: string;
  build?: string;
  surface?: string;
  version?: string;
}

export interface UltramodernPerformanceSignalPayload {
  signalId: UltramodernPerformanceReadinessSignalId;
  status: UltramodernPerformanceReadinessSignalStatus;
  durationMs?: number;
  detail?: Record<string, unknown>;
}

export interface UltramodernWorkspaceEventPayloadMap {
  'ultramodern:navigate': UltramodernNavigatePayload;
  'ultramodern:performance-signal': UltramodernPerformanceSignalPayload;
  'ultramodern:remote-ready': UltramodernRemoteReadyPayload;
  'ultramodern:route-settled': UltramodernRouteSettledPayload;
}

export class UltramodernWorkspaceEventValidationError {
  readonly message: string;
  readonly name = 'UltramodernWorkspaceEventValidationError';
  readonly eventName: UltramodernWorkspaceEventName;
  readonly payload: unknown;

  constructor(eventName: UltramodernWorkspaceEventName, payload: unknown) {
    this.message = `Invalid payload for UltraModern workspace event "${eventName}"`;
    this.eventName = eventName;
    this.payload = payload;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isUltramodernWorkspaceLocale = (
  value: unknown,
): value is UltramodernWorkspaceLocale => value === 'en' || value === 'cs';

const isPerformanceReadinessSignalId = (
  value: unknown,
): value is UltramodernPerformanceReadinessSignalId =>
  value === 'bfcache' ||
  value === 'core-web-vitals-rum' ||
  value === 'duplicate-prefetch-warmup' ||
  value === 'cache-policy-sanity' ||
  value === 'save-data-behavior' ||
  value === 'cloudflare-ssr-cache-hints';

const isPerformanceReadinessSignalStatus = (
  value: unknown,
): value is UltramodernPerformanceReadinessSignalStatus =>
  value === 'pass' || value === 'warn' || value === 'fail';

const hasOptionalString = (value: Record<string, unknown>, key: string) =>
  value[key] === undefined || isNonEmptyString(value[key]);

const hasOptionalBoolean = (value: Record<string, unknown>, key: string) =>
  value[key] === undefined || typeof value[key] === 'boolean';

const hasOptionalRecord = (value: Record<string, unknown>, key: string) =>
  value[key] === undefined || isRecord(value[key]);

const hasOptionalNonNegativeNumber = (
  value: Record<string, unknown>,
  key: string,
) => value[key] === undefined || isNonNegativeNumber(value[key]);

const hasOptionalLocale = (value: Record<string, unknown>, key: string) =>
  value[key] === undefined || isUltramodernWorkspaceLocale(value[key]);

export const isUltramodernNavigatePayload = (
  payload: unknown,
): payload is UltramodernNavigatePayload =>
  isRecord(payload) &&
  isNonEmptyString(payload['to']) &&
  hasOptionalBoolean(payload, 'replace') &&
  hasOptionalRecord(payload, 'state');

export const isUltramodernRouteSettledPayload = (
  payload: unknown,
): payload is UltramodernRouteSettledPayload =>
  isRecord(payload) &&
  isNonEmptyString(payload['pathname']) &&
  hasOptionalLocale(payload, 'locale') &&
  hasOptionalString(payload, 'title');

export const isUltramodernRemoteReadyPayload = (
  payload: unknown,
): payload is UltramodernRemoteReadyPayload =>
  isRecord(payload) &&
  isNonEmptyString(payload['appId']) &&
  hasOptionalString(payload, 'build') &&
  hasOptionalString(payload, 'surface') &&
  hasOptionalString(payload, 'version');

export const isUltramodernPerformanceSignalPayload = (
  payload: unknown,
): payload is UltramodernPerformanceSignalPayload =>
  isRecord(payload) &&
  isPerformanceReadinessSignalId(payload['signalId']) &&
  isPerformanceReadinessSignalStatus(payload['status']) &&
  hasOptionalNonNegativeNumber(payload, 'durationMs') &&
  hasOptionalRecord(payload, 'detail');

const ultramodernWorkspaceEventValidators: {
  [Name in UltramodernWorkspaceEventName]: (
    payload: unknown,
  ) => payload is UltramodernWorkspaceEventPayloadMap[Name];
} = {
  [ultramodernWorkspaceEventNames.navigate]: isUltramodernNavigatePayload,
  [ultramodernWorkspaceEventNames.performanceSignal]:
    isUltramodernPerformanceSignalPayload,
  [ultramodernWorkspaceEventNames.remoteReady]:
    isUltramodernRemoteReadyPayload,
  [ultramodernWorkspaceEventNames.routeSettled]:
    isUltramodernRouteSettledPayload,
};

export const isUltramodernWorkspaceEventPayload = <
  Name extends UltramodernWorkspaceEventName,
>(
  eventName: Name,
  payload: unknown,
): payload is UltramodernWorkspaceEventPayloadMap[Name] =>
  ultramodernWorkspaceEventValidators[eventName](payload);

export const assertUltramodernWorkspaceEventPayload = <
  Name extends UltramodernWorkspaceEventName,
>(
  eventName: Name,
  payload: unknown,
): UltramodernWorkspaceEventPayloadMap[Name] => {
  if (!isUltramodernWorkspaceEventPayload(eventName, payload)) {
    throw new UltramodernWorkspaceEventValidationError(eventName, payload);
  }

  return payload;
};

export const createUltramodernWorkspaceEvent = <
  Name extends UltramodernWorkspaceEventName,
>(
  eventName: Name,
  payload: UltramodernWorkspaceEventPayloadMap[Name],
): CustomEvent<UltramodernWorkspaceEventPayloadMap[Name]> =>
  new CustomEvent(eventName, {
    bubbles: true,
    composed: true,
    detail: assertUltramodernWorkspaceEventPayload(eventName, payload),
  });

export const dispatchUltramodernWorkspaceEvent = <
  Name extends UltramodernWorkspaceEventName,
>(
  target: EventTarget,
  eventName: Name,
  payload: UltramodernWorkspaceEventPayloadMap[Name],
) =>
  target.dispatchEvent(
    createUltramodernWorkspaceEvent(eventName, payload),
  );

export const onUltramodernWorkspaceEvent = <
  Name extends UltramodernWorkspaceEventName,
>(
  target: EventTarget,
  eventName: Name,
  handler: (
    payload: UltramodernWorkspaceEventPayloadMap[Name],
    event: CustomEvent<UltramodernWorkspaceEventPayloadMap[Name]>,
  ) => void,
) => {
  const listener = (event: Event) => {
    if (!('detail' in event)) {
      throw new UltramodernWorkspaceEventValidationError(
        eventName,
        undefined,
      );
    }

    const customEvent = event as CustomEvent<unknown>;
    handler(
      assertUltramodernWorkspaceEventPayload(eventName, customEvent.detail),
      customEvent as CustomEvent<UltramodernWorkspaceEventPayloadMap[Name]>,
    );
  };

  target.addEventListener(eventName, listener);

  return () => {
    target.removeEventListener(eventName, listener);
  };
};

export const dispatchUltramodernNavigate = (
  target: EventTarget,
  payload: UltramodernNavigatePayload,
) =>
  dispatchUltramodernWorkspaceEvent(
    target,
    ultramodernWorkspaceEventNames.navigate,
    payload,
  );

export const dispatchUltramodernRouteSettled = (
  target: EventTarget,
  payload: UltramodernRouteSettledPayload,
) =>
  dispatchUltramodernWorkspaceEvent(
    target,
    ultramodernWorkspaceEventNames.routeSettled,
    payload,
  );

export const dispatchUltramodernRemoteReady = (
  target: EventTarget,
  payload: UltramodernRemoteReadyPayload,
) =>
  dispatchUltramodernWorkspaceEvent(
    target,
    ultramodernWorkspaceEventNames.remoteReady,
    payload,
  );

export const dispatchUltramodernPerformanceSignal = (
  target: EventTarget,
  payload: UltramodernPerformanceSignalPayload,
) =>
  dispatchUltramodernWorkspaceEvent(
    target,
    ultramodernWorkspaceEventNames.performanceSignal,
    payload,
  );

export const onUltramodernNavigate = (
  target: EventTarget,
  handler: (
    payload: UltramodernNavigatePayload,
    event: CustomEvent<UltramodernNavigatePayload>,
  ) => void,
) =>
  onUltramodernWorkspaceEvent(
    target,
    ultramodernWorkspaceEventNames.navigate,
    handler,
  );

export const onUltramodernRouteSettled = (
  target: EventTarget,
  handler: (
    payload: UltramodernRouteSettledPayload,
    event: CustomEvent<UltramodernRouteSettledPayload>,
  ) => void,
) =>
  onUltramodernWorkspaceEvent(
    target,
    ultramodernWorkspaceEventNames.routeSettled,
    handler,
  );

export const onUltramodernRemoteReady = (
  target: EventTarget,
  handler: (
    payload: UltramodernRemoteReadyPayload,
    event: CustomEvent<UltramodernRemoteReadyPayload>,
  ) => void,
) =>
  onUltramodernWorkspaceEvent(
    target,
    ultramodernWorkspaceEventNames.remoteReady,
    handler,
  );

export const onUltramodernPerformanceSignal = (
  target: EventTarget,
  handler: (
    payload: UltramodernPerformanceSignalPayload,
    event: CustomEvent<UltramodernPerformanceSignalPayload>,
  ) => void,
) =>
  onUltramodernWorkspaceEvent(
    target,
    ultramodernWorkspaceEventNames.performanceSignal,
    handler,
  );
