import type {
  ResolvedUltramodernPackageSource,
  UltramodernPackageSourceStrategy,
} from '../ultramodern-package-source';
import type { UltramodernBridgeConfigInput } from './bridge-config';
import type { DeliveryUnitDescriptor } from './delivery-unit-schema/types';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };
export type RouteJsonLd = JsonObject | JsonObject[];

export function sortJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }

  return value;
}

/**
 * Vertical generation preset (G2a). `full-stack` is the legacy default and
 * produces byte-identical output. `api-only` omits every browser/UI artifact
 * (routes, components, MF browser exposes, Tailwind) and keeps the API + BFF +
 * backend-federation surfaces (a headless delivery unit). `ui-only` omits every
 * API/BFF/backend artifact and keeps routes/components/exposes.
 */
export type VerticalPreset = 'full-stack' | 'api-only' | 'ui-only';

/**
 * API protocol SPI (G7a). `rest` is the legacy default (Effect HttpApi output,
 * byte-identical). `rpc` generates an Effect RPC contract/handlers/client on
 * plugin-bff's RPC runtime primitives. GraphQL is intentionally not implemented
 * (the SPI shape leaves room to add it later).
 */
export type VerticalApiProtocol = 'rest' | 'rpc';

export function isVerticalPreset(value: unknown): value is VerticalPreset {
  return value === 'full-stack' || value === 'api-only' || value === 'ui-only';
}

export function isVerticalApiProtocol(
  value: unknown,
): value is VerticalApiProtocol {
  return value === 'rest' || value === 'rpc';
}

/**
 * The canonical kind of the generated delivery unit. `microvertical` is the
 * default. `horizontal-remote` (G2H) is a components-only cross-vertical
 * delivery unit that is not the frontend/backend half of a MicroVertical
 * (CONTEXT.md: Horizontal Remote). It is unrepresentable in strict v1, so the
 * on-disk v1 `WorkspaceApp.kind` stays `vertical` (lossy down-projection) while
 * the true kind is carried additively on the topology entry and the canonical
 * schemaVersion-2 delivery-unit descriptor.
 */
export type WorkspaceDeliveryUnitKind = 'microvertical' | 'horizontal-remote';

export function isWorkspaceDeliveryUnitKind(
  value: unknown,
): value is WorkspaceDeliveryUnitKind {
  return value === 'microvertical' || value === 'horizontal-remote';
}

export type WorkspaceApp = {
  id: string;
  directory: string;
  packageSuffix: string;
  displayName: string;
  kind: 'shell' | 'vertical';
  domain?: string;
  portEnv: string;
  port: number;
  mfName: string;
  exposes?: Record<string, string>;
  api?: WorkspaceApi;
  verticalRefs?: string[];
  ownership: Ownership;
  /**
   * Generation preset (G2a). Omitted for the legacy `full-stack` default so
   * default descriptors and their serialized output stay byte-identical; only
   * `api-only` / `ui-only` set it, gating the UI/API writers respectively.
   */
  surfaceProfile?: VerticalPreset;
  /**
   * Canonical delivery-unit kind (G2H). Omitted for the `microvertical`
   * default. `horizontal-remote` marks a components-only unit; it never changes
   * the v1 `kind` field (which stays `vertical`).
   */
  deliveryUnitKind?: WorkspaceDeliveryUnitKind;
  /**
   * Existing additional shells carry their stamped delivery-unit contract
   * through regeneration (G28). Keeping this on the descriptor prevents a later
   * add-vertical/migrate pass from minting a new build marker for an already
   * generated shell.
   */
  deliveryUnit?: JsonObject;
};

export type WorkspaceApi = {
  stem: string;
  prefix: string;
  consumedBy: string[];
  /**
   * API protocol (G7a). Omitted for the legacy `rest` default so default API
   * output stays byte-identical; only `rpc` sets it.
   */
  protocol?: VerticalApiProtocol;
};

export type ResolvedPackageSource = ResolvedUltramodernPackageSource;

/**
 * Attribution of the single accountable owner of a delivery unit (G3). Kind +
 * id mirror the canonical `DeliveryUnitOwner` (delivery-unit-schema) so an
 * attribution is structurally assignable to it. CONTEXT.md: a MicroVertical
 * never has more than one owner, and one owner may own many verticals — the
 * attribution is keyed to the delivery unit, not the team org chart.
 */
export type OwnerAttribution = {
  kind: 'team' | 'agent' | 'agent-team';
  id: string;
  contact?: string;
};

export type Ownership = {
  team: string;
  slack: string;
  pagerDuty: string;
  runbookRef: string;
  adrRef: string;
  blastRadius: {
    tier: string;
    references: string[];
  };
  /**
   * Optional explicit owner attribution (G3). Omitted by default so generated
   * ownership metadata stays byte-identical; callers opt in to record an
   * `agent` / `agent-team` owner. When absent, {@link resolveOwnerAttribution}
   * defaults to the neutral `team` owner derived from `team`.
   */
  owner?: OwnerAttribution;
};

/**
 * Resolve the single owner attribution for an ownership record (G3). Returns
 * the explicit `owner` when a caller opted in, otherwise the neutral default
 * `{ kind: 'team', id: ownership.team }`. Pure; does not mutate or emit —
 * legacy generation stays byte-identical because nothing serializes this
 * unless `ownership.owner` was set.
 */
export function resolveOwnerAttribution(
  ownership: Ownership,
): OwnerAttribution {
  return ownership.owner ?? { kind: 'team', id: ownership.team };
}

export const supportedWorkspaceLanguages = ['en', 'cs'] as const;
export type SupportedWorkspaceLanguage =
  (typeof supportedWorkspaceLanguages)[number];

type RoutePublicSurface =
  | 'private-app-screen'
  | 'generated-public-surface'
  | 'explicit-public-input';

export type RouteOwnedI18nPath = {
  id: string;
  canonicalPath: string;
  localisedPaths: Record<SupportedWorkspaceLanguage, string>;
  titleKey: string;
  descriptionKey: string;
  ownerAppId: string;
  mfBoundaryId: string;
  namespace: string;
  public: boolean;
  indexable: boolean;
  publicSurface: RoutePublicSurface;
  jsonLd?: RouteJsonLd;
};

export type PublicRouteMetadata = {
  canonicalPath: string;
  id: string;
  localisedPaths: Record<SupportedWorkspaceLanguage, string>;
  namespace: string;
  ownerAppId: string;
  titleKey: string;
  descriptionKey: string;
  jsonLd?: RouteJsonLd;
};

type PublicSitemapChangeFrequency =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

export type PublicSurfaceSitemapFields = {
  lastModified?: string;
  changeFrequency?: PublicSitemapChangeFrequency;
  priority?: number;
};

export type UltramodernWorkspaceOptions = {
  targetDir: string;
  packageName: string;
  modernVersion: string;
  enableTailwind?: boolean;
  generateAgentFiles?: boolean;
  overlays?: UltramodernCodeSmithOverlay[];
  bridge?: UltramodernBridgeConfigInput;
  packageSource?: {
    strategy?: UltramodernPackageSourceStrategy;
    modernPackageVersion?: string;
    registry?: string;
    aliasScope?: string;
    aliasPackageNamePrefix?: string;
  };
};

export type AddUltramodernVerticalOptions = {
  workspaceRoot: string;
  name: string;
  modernVersion: string;
  enableTailwind?: boolean;
  overlays?: UltramodernCodeSmithOverlay[];
  packageSource?: UltramodernWorkspaceOptions['packageSource'];
  /**
   * Vertical generation preset (G2a). Defaults to `full-stack` (byte-identical
   * legacy output). `api-only` / `ui-only` restrict the generated surfaces.
   */
  preset?: VerticalPreset;
  /**
   * API protocol (G7a). Defaults to `rest` (byte-identical Effect HttpApi
   * output). `rpc` emits an Effect RPC contract/handlers/client. Ignored for a
   * `ui-only` preset (no API surface) and for a horizontal remote.
   */
  apiProtocol?: VerticalApiProtocol;
  /**
   * Generate a components-only Horizontal Remote delivery unit (G2H) instead of
   * a MicroVertical. Implies a UI-only surface set with no API.
   */
  horizontalRemote?: boolean;
  /**
   * Target shell id that should compose the new MicroVertical (G28). Defaults
   * to the primary shell (`shell-super-app`) — the default keeps legacy
   * single-shell behaviour byte-identical. An explicit id targets an additional
   * shell; targeting an unknown shell is rejected in preflight.
   */
  shell?: string;
};

/**
 * Options for adding an additional thin shell to an existing workspace (G28).
 * The new shell is its own Delivery Unit that composes a chosen subset of the
 * workspace's existing verticals.
 */
export type AddUltramodernShellOptions = {
  workspaceRoot: string;
  name: string;
  modernVersion: string;
  /**
   * Ids of existing verticals the new shell should compose. Defaults to every
   * vertical currently in the workspace.
   */
  verticals?: string[];
  enableTailwind?: boolean;
  packageSource?: UltramodernWorkspaceOptions['packageSource'];
};

export type UltramodernGenerationOperation = 'workspace' | 'vertical' | 'shell';

/**
 * Stable public descriptor for an app created by the UltraModern generator.
 * Existing fields keep their meaning across patch/minor releases; new fields
 * may be added as the generator records more contract data.
 */
export type UltramodernGeneratedAppDescriptor = {
  id: string;
  directory: string;
  packageName: string;
  packageSuffix: string;
  displayName: string;
  kind: WorkspaceApp['kind'];
  portEnv: string;
  port: number;
  moduleFederationName: string;
  exposes?: Record<string, string>;
  apiPrefix?: string;
};

/**
 * Stable public warning shape for non-fatal generator decisions.
 */
export type UltramodernGenerationWarning = {
  code: string;
  message: string;
  path?: string;
};

/**
 * Stable public result returned by workspace generation and MicroVertical
 * addition. The CLI ignores this object, but automation can use it instead of
 * re-reading the workspace to discover generated paths and integration data.
 */
export type UltramodernGenerationResult = {
  operation: UltramodernGenerationOperation;
  workspaceRoot: string;
  packageScope: string;
  packageSource: ResolvedPackageSource;
  createdApps: UltramodernGeneratedAppDescriptor[];
  createdPaths: string[];
  rewrittenPaths: string[];
  assignedPorts: Record<string, number>;
  moduleFederationNames: Record<string, string>;
  apiPrefixes: Record<string, string>;
  generatedContractPath: string;
  warnings: UltramodernGenerationWarning[];
  /**
   * Canonical delivery-unit descriptor per generated app (G1d). Additive and
   * optional: existing fields are unchanged. Each descriptor's `unitId`,
   * `buildMarker`, and `sourceRevision` match the emitted delivery-unit records
   * (built from the same generator functions in the same process), so
   * automation can consume the canonical shape without re-reading the
   * workspace. Down-projecting a descriptor reproduces the v1 `WorkspaceApp`
   * identity (see `projectDeliveryUnitToV1`).
   */
  deliveryUnits?: DeliveryUnitDescriptor[];
};

export type UltramodernCodeSmithOverlay = {
  generator: string;
  config?: Record<string, unknown>;
};

export type UltramodernCodeSmithOverlayRuntimeConfig = {
  /** Logical final workspace path exposed to generated configuration. */
  workspaceRoot: string;
  /** Physical directory that the overlay must write into during generation. */
  outputWorkspaceRoot: string;
  packageScope: string;
  operation: UltramodernGenerationOperation;
  generatedApp?: UltramodernGeneratedAppDescriptor;
  generatedApps: UltramodernGeneratedAppDescriptor[];
  assignedPort?: number;
  assignedPorts: Record<string, number>;
  moduleFederationName?: string;
  moduleFederationNames: Record<string, string>;
  apiPrefix?: string;
  apiPrefixes: Record<string, string>;
  packageSource: ResolvedPackageSource;
  generationResult: UltramodernGenerationResult;
};

export type UltramodernJsonMutation = {
  path: string;
  pointer: string;
  description: string;
  value?: JsonValue;
};

export type UltramodernShellDependencyChange = {
  path: string;
  section: 'dependencies' | 'zephyr:dependencies';
  packageName: string;
  version: string;
};

export type UltramodernGeneratedContractChange = {
  path: string;
  addedAppIds: string[];
  shellVerticalRefs: string[];
};

/**
 * Stable public dry-run result for MicroVertical addition. It includes the
 * same operation summary as a real add, plus planned JSON mutations and
 * integration metadata that automation can inspect before writing files.
 */
export type UltramodernVerticalPlan = UltramodernGenerationResult & {
  dryRun: true;
  selectedPort: number;
  moduleFederationRemote: {
    id: string;
    name: string;
    manifestUrl: string;
  };
  apiPrefix?: string;
  jsonMutations: UltramodernJsonMutation[];
  shellDependencyChanges: UltramodernShellDependencyChange[];
  generatedContractChanges: UltramodernGeneratedContractChange[];
};

export function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
