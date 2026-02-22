import garfish, { interfaces as GarfishInterfaces } from 'garfish';
import React, { useContext } from 'react';
import { logger } from '../util';
import { GarfishContext } from './utils/Context';

export type Options = typeof garfish.options;
export type RuntimeCompatibilityMode = 'off' | 'warn' | 'strict';
export type RuntimeCompatibilityIssueReason =
  | 'digest_mismatch'
  | 'missing_remote_digest';
export type RuntimeCompatibilityIssue = {
  appName: string;
  hostDigest: string;
  remoteDigest?: string;
  reason: RuntimeCompatibilityIssueReason;
};
export type RuntimeCompatibilityPolicy = {
  hostDigest: string;
  mode?: RuntimeCompatibilityMode;
  requireRemoteDigest?: boolean;
  onIncompatible?: (issue: RuntimeCompatibilityIssue) => void;
};
export type RemoteTrustMode = 'off' | 'warn' | 'strict';
export type RemoteTrustIssueReason =
  | 'origin_not_allowed'
  | 'origin_isolation_violation'
  | 'integrity_missing'
  | 'integrity_invalid_format'
  | 'integrity_fetch_failed'
  | 'integrity_timeout'
  | 'integrity_verification_unavailable'
  | 'integrity_mismatch'
  | 'attestation_missing'
  | 'attestation_mismatch';
export type RemoteTrustIssue = {
  appName: string;
  entry: string;
  reason: RemoteTrustIssueReason;
  origin?: string;
  expectedOrigin?: string;
  expectedIntegrity?: string;
  actualIntegrity?: string;
  expectedAttestation?: string;
  actualAttestation?: string;
};
export type RemoteTrustPolicy = {
  mode?: RemoteTrustMode;
  productionOnly?: boolean;
  allowedOrigins?: string[];
  isolatedOrigins?: Record<string, string>;
  singleOriginIsolation?: boolean;
  requireIntegrity?: boolean;
  verifyIntegrity?: boolean;
  integrityFetchTimeoutMs?: number;
  requireAttestation?: boolean;
  attestations?: Record<string, string>;
  onViolation?: (issue: RemoteTrustIssue) => void;
};
export type MfFallbackReason =
  | 'runtime_incompatible'
  | 'origin_not_allowed'
  | 'origin_isolation_violation'
  | 'integrity_missing'
  | 'integrity_invalid'
  | 'integrity_mismatch'
  | 'integrity_fetch_failed'
  | 'integrity_timeout'
  | 'attestation_missing'
  | 'attestation_mismatch'
  | 'runtime_init_failed'
  | 'remote_load_failed'
  | 'remote_mount_failed'
  | 'remote_unmount_failed';
export type MfFallbackPhase =
  | 'bootstrap'
  | 'compatibility'
  | 'integrity'
  | 'load'
  | 'mount'
  | 'unmount';
export type MfFallbackEvent = {
  reason: MfFallbackReason;
  phase: MfFallbackPhase;
  appName?: string;
  entry?: string;
  message?: string;
  code?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
};
export type MfFallbackTelemetryConfig = {
  onFallback?: (event: MfFallbackEvent) => void;
  eventName?: string;
  emitConsole?: boolean;
  emitWindowEvent?: boolean;
};
export type ModuleInfo = GarfishInterfaces.AppInfo & {
  Component?: React.ComponentType | React.ElementType;
  path?: string;
  originInfo?: Record<string, unknown>;
  runtimeDigest?: string;
  integrity?: string;
  attestation?: string;
  runtimeMetadata?: {
    runtimeDigest?: string;
    integrity?: string;
    attestation?: string;
  };
};
export type ModulesInfo = Array<ModuleInfo>;

export type Manifest = {
  modules?: ModulesInfo;
  loadable?: LoadableConfig;
  componentRender?: boolean;
  getAppList?: (info: any) => Promise<Array<GarfishInterfaces.AppInfo>>;
  runtimeDigest?: string;
  runtimeCompatibility?: RuntimeCompatibilityPolicy;
  remoteTrust?: RemoteTrustPolicy;
  fallbackTelemetry?: MfFallbackTelemetryConfig;
};

export type LoadingComponent = React.ComponentType<{
  isLoading: boolean;
  pastDelay: boolean;
  timedOut: boolean;
  error: any;
  retry: () => void;
}>;

export interface LoadableConfig {
  timeout?: number;
  delay?: number;
  loading?: LoadingComponent;
}

export type ModernGarfishConfig = {
  manifest?: Manifest;
  runtimeCompatibility?: RuntimeCompatibilityPolicy;
  remoteTrust?: RemoteTrustPolicy;
  fallbackTelemetry?: MfFallbackTelemetryConfig;
};

export type MicroComponentProps = {
  loadable?: LoadableConfig;
  [index: string]: any;
};

export type Config = Partial<Options> & ModernGarfishConfig;

export type UseModuleApps = {
  [index in 'apps' | string]: index extends 'apps'
    ? ModulesInfo
    : React.FC<MicroComponentProps>;
} & {
  readonly MApp: React.FC<MicroComponentProps>;
  readonly apps: ModulesInfo;
};

export function useModuleApps() {
  const { apps, MApp, appInfoList } = useContext(GarfishContext);
  logger('call useModuleApps', {
    MApp,
    apps: appInfoList,
    ...apps,
  });

  const Info = new Proxy(
    {
      MApp,
      apps: appInfoList,
      ...apps,
    },
    {
      get(target, p, receiver) {
        if (typeof p === 'string' && p in target) {
          return Reflect.get(target, p, receiver);
        }
        return () => React.createElement('div');
      },
    },
  );

  return Info as UseModuleApps;
}

export function useModuleApp() {
  const { MApp } = useContext(GarfishContext);
  logger('call useModuleApps', MApp);
  return MApp;
}
