export type UltramodernPublicSitemapChangeFrequency =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

export type UltramodernPublicSitemapEntry = {
  /**
   * Params used to expand every localized route pattern, for example
   * { slug: 'platform-story' } for /talks/:slug.
   */
  params: Record<string, string | number | boolean>;
  /**
   * Per-locale overrides when translated URLs use translated params.
   */
  localeParams?: Partial<Record<'en' | 'cs', Record<string, string | number | boolean>>>;
  draft?: boolean;
  indexable?: boolean;
  lastModified?: string;
  changeFrequency?: UltramodernPublicSitemapChangeFrequency;
  priority?: number;
};

export type UltramodernPerformanceReadinessSignalId =
  | 'bfcache'
  | 'core-web-vitals-rum'
  | 'duplicate-prefetch-warmup'
  | 'cache-policy-sanity'
  | 'save-data-behavior'
  | 'cloudflare-ssr-cache-hints';

export type UltramodernPerformanceReadinessDiagnosticsConfig = {
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
};

export const ultramodernWorkspaceContract = {
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
  ownership: 'topology/ownership.json',
  preset: 'presetUltramodern',
  topology: 'topology/reference-topology.json',
} as const;

export const tractorEventNames = {
  checkoutAddToCart: 'checkout:add-to-cart',
  checkoutCartUpdated: 'checkout:cart-updated',
  checkoutClearCart: 'checkout:clear-cart',
  checkoutRemoveFromCart: 'checkout:remove-from-cart',
  exploreSelectedShop: 'explore:selected-shop',
  mfNavigate: 'mf:navigate',
} as const;

export type TractorEventName =
  (typeof tractorEventNames)[keyof typeof tractorEventNames];

export interface CheckoutAddToCartPayload {
  sku: string;
  quantity: number;
  name?: string;
  shopId?: string;
  unitPriceCents?: number;
}

export interface CheckoutCartLinePayload {
  sku: string;
  quantity: number;
  name?: string;
  unitPriceCents?: number;
}

export interface CheckoutCartUpdatedPayload {
  lines: readonly CheckoutCartLinePayload[];
  totalQuantity: number;
  subtotalCents?: number;
}

export interface CheckoutRemoveFromCartPayload {
  sku: string;
}

export interface CheckoutClearCartPayload {
  reason?: string;
}

export interface ExploreSelectedShopPayload {
  shopId: string;
  name?: string;
}

export interface MfNavigatePayload {
  to: string;
  replace?: boolean;
  state?: Record<string, unknown>;
}

export interface TractorEventPayloadMap {
  'checkout:add-to-cart': CheckoutAddToCartPayload;
  'checkout:cart-updated': CheckoutCartUpdatedPayload;
  'checkout:clear-cart': CheckoutClearCartPayload;
  'checkout:remove-from-cart': CheckoutRemoveFromCartPayload;
  'explore:selected-shop': ExploreSelectedShopPayload;
  'mf:navigate': MfNavigatePayload;
}

export class TractorEventValidationError extends Error {
  readonly eventName: TractorEventName;
  readonly payload: unknown;

  constructor(eventName: TractorEventName, payload: unknown) {
    super(`Invalid payload for Tractor event "${eventName}"`);
    this.name = 'TractorEventValidationError';
    this.eventName = eventName;
    this.payload = payload;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && value >= 0;

const hasOptionalString = (value: Record<string, unknown>, key: string) =>
  value[key] === undefined || isNonEmptyString(value[key]);

const hasOptionalBoolean = (value: Record<string, unknown>, key: string) =>
  value[key] === undefined || typeof value[key] === 'boolean';

const hasOptionalRecord = (value: Record<string, unknown>, key: string) =>
  value[key] === undefined || isRecord(value[key]);

const hasOptionalNonNegativeInteger = (
  value: Record<string, unknown>,
  key: string,
) => value[key] === undefined || isNonNegativeInteger(value[key]);

export const isCheckoutAddToCartPayload = (
  payload: unknown,
): payload is CheckoutAddToCartPayload =>
  isRecord(payload) &&
  isNonEmptyString(payload['sku']) &&
  isPositiveInteger(payload['quantity']) &&
  hasOptionalString(payload, 'name') &&
  hasOptionalString(payload, 'shopId') &&
  hasOptionalNonNegativeInteger(payload, 'unitPriceCents');

export const isCheckoutCartLinePayload = (
  payload: unknown,
): payload is CheckoutCartLinePayload =>
  isRecord(payload) &&
  isNonEmptyString(payload['sku']) &&
  isPositiveInteger(payload['quantity']) &&
  hasOptionalString(payload, 'name') &&
  hasOptionalNonNegativeInteger(payload, 'unitPriceCents');

export const isCheckoutCartUpdatedPayload = (
  payload: unknown,
): payload is CheckoutCartUpdatedPayload =>
  isRecord(payload) &&
  Array.isArray(payload['lines']) &&
  payload['lines'].every(isCheckoutCartLinePayload) &&
  isNonNegativeInteger(payload['totalQuantity']) &&
  hasOptionalNonNegativeInteger(payload, 'subtotalCents');

export const isCheckoutRemoveFromCartPayload = (
  payload: unknown,
): payload is CheckoutRemoveFromCartPayload =>
  isRecord(payload) && isNonEmptyString(payload['sku']);

export const isCheckoutClearCartPayload = (
  payload: unknown,
): payload is CheckoutClearCartPayload =>
  isRecord(payload) && hasOptionalString(payload, 'reason');

export const isExploreSelectedShopPayload = (
  payload: unknown,
): payload is ExploreSelectedShopPayload =>
  isRecord(payload) &&
  isNonEmptyString(payload['shopId']) &&
  hasOptionalString(payload, 'name');

export const isMfNavigatePayload = (
  payload: unknown,
): payload is MfNavigatePayload =>
  isRecord(payload) &&
  isNonEmptyString(payload['to']) &&
  hasOptionalBoolean(payload, 'replace') &&
  hasOptionalRecord(payload, 'state');

const tractorEventValidators = {
  [tractorEventNames.checkoutAddToCart]: isCheckoutAddToCartPayload,
  [tractorEventNames.checkoutCartUpdated]: isCheckoutCartUpdatedPayload,
  [tractorEventNames.checkoutClearCart]: isCheckoutClearCartPayload,
  [tractorEventNames.checkoutRemoveFromCart]: isCheckoutRemoveFromCartPayload,
  [tractorEventNames.exploreSelectedShop]: isExploreSelectedShopPayload,
  [tractorEventNames.mfNavigate]: isMfNavigatePayload,
} satisfies {
  [Name in TractorEventName]: (
    payload: unknown,
  ) => payload is TractorEventPayloadMap[Name];
};

export const isTractorEventPayload = <Name extends TractorEventName>(
  eventName: Name,
  payload: unknown,
): payload is TractorEventPayloadMap[Name] =>
  tractorEventValidators[eventName](payload);

export const assertTractorEventPayload = <Name extends TractorEventName>(
  eventName: Name,
  payload: unknown,
): TractorEventPayloadMap[Name] => {
  if (!isTractorEventPayload(eventName, payload)) {
    throw new TractorEventValidationError(eventName, payload);
  }

  return payload;
};

export const createTractorEvent = <Name extends TractorEventName>(
  eventName: Name,
  payload: TractorEventPayloadMap[Name],
): CustomEvent<TractorEventPayloadMap[Name]> =>
  new CustomEvent(eventName, {
    bubbles: true,
    composed: true,
    detail: assertTractorEventPayload(eventName, payload),
  });

export const dispatchTractorEvent = <Name extends TractorEventName>(
  target: EventTarget,
  eventName: Name,
  payload: TractorEventPayloadMap[Name],
) => target.dispatchEvent(createTractorEvent(eventName, payload));

export const onTractorEvent = <Name extends TractorEventName>(
  target: EventTarget,
  eventName: Name,
  handler: (
    payload: TractorEventPayloadMap[Name],
    event: CustomEvent<TractorEventPayloadMap[Name]>,
  ) => void,
) => {
  const listener = (event: Event) => {
    if (!('detail' in event)) {
      throw new TractorEventValidationError(eventName, undefined);
    }

    const customEvent = event as CustomEvent<unknown>;
    handler(
      assertTractorEventPayload(eventName, customEvent.detail),
      customEvent as CustomEvent<TractorEventPayloadMap[Name]>,
    );
  };

  target.addEventListener(eventName, listener);

  return () => {
    target.removeEventListener(eventName, listener);
  };
};

const normalizeCheckoutLine = (
  line: CheckoutCartLinePayload,
): CheckoutCartLinePayload => {
  if (!isCheckoutCartLinePayload(line)) {
    throw new TractorEventValidationError('checkout:cart-updated', line);
  }

  return {
    sku: line.sku,
    quantity: line.quantity,
    ...(line.name === undefined ? {} : { name: line.name }),
    ...(line.unitPriceCents === undefined
      ? {}
      : { unitPriceCents: line.unitPriceCents }),
  };
};

export const createCheckoutCartSnapshot = (
  lines: readonly CheckoutCartLinePayload[],
): CheckoutCartUpdatedPayload => {
  const normalizedLines = lines.map(line => normalizeCheckoutLine(line));
  const subtotalCents = normalizedLines.reduce(
    (total, line) => total + (line.unitPriceCents ?? 0) * line.quantity,
    0,
  );

  return {
    lines: normalizedLines,
    totalQuantity: normalizedLines.reduce(
      (total, line) => total + line.quantity,
      0,
    ),
    ...(subtotalCents === 0 ? {} : { subtotalCents }),
  };
};

export const applyCheckoutCartEvent = (
  cart: CheckoutCartUpdatedPayload,
  eventName:
    | 'checkout:add-to-cart'
    | 'checkout:remove-from-cart'
    | 'checkout:clear-cart',
  payload:
    | CheckoutAddToCartPayload
    | CheckoutRemoveFromCartPayload
    | CheckoutClearCartPayload,
): CheckoutCartUpdatedPayload => {
  if (eventName === 'checkout:clear-cart') {
    assertTractorEventPayload(eventName, payload);
    return createCheckoutCartSnapshot([]);
  }

  if (eventName === 'checkout:remove-from-cart') {
    const removePayload = assertTractorEventPayload(eventName, payload);
    return createCheckoutCartSnapshot(
      cart.lines.filter(line => line.sku !== removePayload.sku),
    );
  }

  const addPayload = assertTractorEventPayload(eventName, payload);
  const lines = cart.lines.map(normalizeCheckoutLine);
  const existingIndex = lines.findIndex(line => line.sku === addPayload.sku);
  const nextLine = normalizeCheckoutLine({
    sku: addPayload.sku,
    quantity: addPayload.quantity,
    ...(addPayload.name === undefined ? {} : { name: addPayload.name }),
    ...(addPayload.unitPriceCents === undefined
      ? {}
      : { unitPriceCents: addPayload.unitPriceCents }),
  });

  if (existingIndex === -1) {
    return createCheckoutCartSnapshot([...lines, nextLine]);
  }

  const existing = lines[existingIndex];
  return createCheckoutCartSnapshot(
    lines.map((line, index) =>
      index === existingIndex
        ? normalizeCheckoutLine({
            ...line,
            ...nextLine,
            quantity: existing.quantity + addPayload.quantity,
          })
        : line,
    ),
  );
};

export const dispatchCheckoutAddToCart = (
  target: EventTarget,
  payload: CheckoutAddToCartPayload,
) => dispatchTractorEvent(target, 'checkout:add-to-cart', payload);

export const dispatchCheckoutCartUpdated = (
  target: EventTarget,
  payload: CheckoutCartUpdatedPayload,
) => dispatchTractorEvent(target, 'checkout:cart-updated', payload);

export const dispatchCheckoutRemoveFromCart = (
  target: EventTarget,
  payload: CheckoutRemoveFromCartPayload,
) => dispatchTractorEvent(target, 'checkout:remove-from-cart', payload);

export const dispatchCheckoutClearCart = (
  target: EventTarget,
  payload: CheckoutClearCartPayload = {},
) => dispatchTractorEvent(target, 'checkout:clear-cart', payload);

export const dispatchExploreSelectedShop = (
  target: EventTarget,
  payload: ExploreSelectedShopPayload,
) => dispatchTractorEvent(target, 'explore:selected-shop', payload);

export const dispatchMfNavigate = (
  target: EventTarget,
  payload: MfNavigatePayload,
) => dispatchTractorEvent(target, 'mf:navigate', payload);

export const onCheckoutAddToCart = (
  target: EventTarget,
  handler: (
    payload: CheckoutAddToCartPayload,
    event: CustomEvent<CheckoutAddToCartPayload>,
  ) => void,
) => onTractorEvent(target, 'checkout:add-to-cart', handler);

export const onCheckoutCartUpdated = (
  target: EventTarget,
  handler: (
    payload: CheckoutCartUpdatedPayload,
    event: CustomEvent<CheckoutCartUpdatedPayload>,
  ) => void,
) => onTractorEvent(target, 'checkout:cart-updated', handler);

export const onCheckoutRemoveFromCart = (
  target: EventTarget,
  handler: (
    payload: CheckoutRemoveFromCartPayload,
    event: CustomEvent<CheckoutRemoveFromCartPayload>,
  ) => void,
) => onTractorEvent(target, 'checkout:remove-from-cart', handler);

export const onCheckoutClearCart = (
  target: EventTarget,
  handler: (
    payload: CheckoutClearCartPayload,
    event: CustomEvent<CheckoutClearCartPayload>,
  ) => void,
) => onTractorEvent(target, 'checkout:clear-cart', handler);

export const onExploreSelectedShop = (
  target: EventTarget,
  handler: (
    payload: ExploreSelectedShopPayload,
    event: CustomEvent<ExploreSelectedShopPayload>,
  ) => void,
) => onTractorEvent(target, 'explore:selected-shop', handler);

export const onMfNavigate = (
  target: EventTarget,
  handler: (
    payload: MfNavigatePayload,
    event: CustomEvent<MfNavigatePayload>,
  ) => void,
) => onTractorEvent(target, 'mf:navigate', handler);
