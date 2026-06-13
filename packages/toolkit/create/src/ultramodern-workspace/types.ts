import type {
  ResolvedUltramodernPackageSource,
  UltramodernPackageSourceStrategy,
} from '../ultramodern-package-source';

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
  effectApi?: WorkspaceEffectApi;
  verticalRefs?: string[];
  ownership: Ownership;
};

export type WorkspaceEffectApi = {
  stem: string;
  prefix: string;
  consumedBy: string[];
};

export type ResolvedPackageSource = ResolvedUltramodernPackageSource;

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
};

export const supportedWorkspaceLanguages = ['en', 'cs'] as const;
export type SupportedWorkspaceLanguage =
  (typeof supportedWorkspaceLanguages)[number];

export type RoutePublicSurface =
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

export type PublicSitemapChangeFrequency =
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
  packageSource?: UltramodernWorkspaceOptions['packageSource'];
};

export function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
