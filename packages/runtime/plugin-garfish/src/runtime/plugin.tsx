import type { Plugin } from '@modern-js/runtime';
import GarfishInstance from 'garfish';
import hoistNonReactStatics from 'hoist-non-react-statics';
import React from 'react';
import { logger } from '../util';
import { applyMfEntryCachePolicy } from './cachePolicy';
import { validateRuntimeCompatibility } from './compatibility';
import {
  emitErrorFallbackTelemetry,
  inferFallbackPhase,
} from './fallbackTelemetry';
import { enforceRemoteTrustPolicy } from './trust';
import type {
  Config,
  Manifest,
  MfFallbackTelemetryConfig,
  MicroComponentProps,
  MicroFrontendProductionProfile,
  ModulesInfo,
  Options,
  RemoteTrustPolicy,
  RuntimeCompatibilityPolicy,
} from './useModuleApps';
import { type AppMap, generateApps } from './utils/apps';
import { GarfishProvider } from './utils/Context';
import { generateMApp } from './utils/MApp';
import setExternal from './utils/setExternal';

const resolveProductionProfile = (
  profile: MicroFrontendProductionProfile | undefined,
) => {
  if (profile) {
    return profile;
  }
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    return 'balanced';
  }
  return 'off';
};

async function initOptions(
  options: Options,
  manifest: Manifest = {},
  remoteTrust?: RemoteTrustPolicy,
  runtimeCompatibility?: RuntimeCompatibilityPolicy,
  productionProfile?: MicroFrontendProductionProfile,
) {
  let apps: ModulesInfo = options.apps || [];
  const modernManifest =
    typeof window !== 'undefined' ? window.modern_manifest : undefined;

  // use manifest modules
  if (manifest?.modules) {
    if (manifest?.modules.length > 0) {
      apps = manifest?.modules;
    }
    logger('manifest modules', apps);
  }

  // get module list
  if (manifest?.getAppList) {
    const getAppList = await manifest?.getAppList(manifest);
    if (getAppList.length > 0) {
      apps = getAppList;
    }
    logger('getAppList modules', apps);
  }

  // get inject modules list
  if (modernManifest?.modules && modernManifest?.modules.length > 0) {
    apps = modernManifest.modules;
    logger('modern_manifest', apps);
  }

  const compatibilityPolicyCandidate: Partial<RuntimeCompatibilityPolicy> = {
    ...runtimeCompatibility,
    ...manifest.runtimeCompatibility,
  };
  const effectiveProductionProfile =
    resolveProductionProfile(productionProfile);
  const runtimeDigestFallback =
    compatibilityPolicyCandidate.hostDigest ||
    manifest.runtimeDigest ||
    modernManifest?.runtimeDigest;
  const compatibilityPolicy =
    effectiveProductionProfile === 'off'
      ? compatibilityPolicyCandidate.hostDigest
        ? (compatibilityPolicyCandidate as RuntimeCompatibilityPolicy)
        : undefined
      : runtimeDigestFallback
        ? ({
            hostDigest: runtimeDigestFallback,
            mode: compatibilityPolicyCandidate.mode || 'strict',
            requireRemoteDigest:
              compatibilityPolicyCandidate.requireRemoteDigest ?? true,
            onIncompatible: compatibilityPolicyCandidate.onIncompatible,
          } as RuntimeCompatibilityPolicy)
        : undefined;

  const remoteTrustPolicyCandidate: Partial<RemoteTrustPolicy> = {
    ...remoteTrust,
    ...manifest.remoteTrust,
  };
  const hasRemoteTrustPolicy =
    Object.keys(remoteTrustPolicyCandidate).length > 0;
  const remoteTrustPolicy =
    effectiveProductionProfile === 'off'
      ? hasRemoteTrustPolicy
        ? (remoteTrustPolicyCandidate as RemoteTrustPolicy)
        : undefined
      : ({
          productionOnly: remoteTrustPolicyCandidate.productionOnly ?? true,
          mode:
            remoteTrustPolicyCandidate.mode ||
            (effectiveProductionProfile === 'strict' ? 'strict' : 'warn'),
          requireIntegrity:
            remoteTrustPolicyCandidate.requireIntegrity ??
            effectiveProductionProfile === 'strict',
          verifyIntegrity:
            remoteTrustPolicyCandidate.verifyIntegrity ??
            effectiveProductionProfile === 'strict',
          requireAttestation:
            remoteTrustPolicyCandidate.requireAttestation ?? false,
          ...remoteTrustPolicyCandidate,
        } as RemoteTrustPolicy);
  apps = applyMfEntryCachePolicy(apps, {
    manifestRuntimeDigest: manifest.runtimeDigest,
    globalRuntimeDigest: modernManifest?.runtimeDigest,
  });
  await enforceRemoteTrustPolicy(apps, remoteTrustPolicy);

  validateRuntimeCompatibility(apps, {
    policy: compatibilityPolicy,
    manifestRuntimeDigest: manifest.runtimeDigest,
    globalRuntimeDigest: modernManifest?.runtimeDigest,
  });

  return {
    ...options,
    apps,
  };
}

// export default garfishPlugin;
export default (config: Config): Plugin => ({
  name: '@modern-js/garfish-plugin',
  setup: () => {
    setExternal();

    const {
      manifest,
      remoteTrust,
      runtimeCompatibility,
      fallbackTelemetry,
      productionProfile,
      ...options
    } = config;
    logger('createPlugin', config);
    const promise = initOptions(
      options,
      manifest,
      remoteTrust,
      runtimeCompatibility,
      productionProfile,
    ).then(
      result => ({
        status: 'fulfilled' as const,
        value: result,
      }),
      error => ({
        status: 'rejected' as const,
        reason: error,
      }),
    );
    const telemetryConfigCandidate: Partial<MfFallbackTelemetryConfig> = {
      ...fallbackTelemetry,
      ...manifest?.fallbackTelemetry,
    };
    const telemetryConfig = Object.keys(telemetryConfigCandidate).length
      ? (telemetryConfigCandidate as MfFallbackTelemetryConfig)
      : undefined;
    const effectiveProductionProfile =
      resolveProductionProfile(productionProfile);
    const resolvedTelemetryConfig =
      telemetryConfig ||
      (effectiveProductionProfile !== 'off'
        ? ({
            reportToServer: true,
            reportEndpoint: '/_modern/contract-gates/runtime-fallback',
          } as MfFallbackTelemetryConfig)
        : undefined);
    return {
      hoc({ App }, next) {
        class GetMicroFrontendApp extends React.Component {
          state: {
            MApp: React.FC<MicroComponentProps>;
            apps: AppMap;
            appInfoList: ModulesInfo;
          } = {
            MApp: () => {
              logger('MApp init Component Render');
              return React.createElement('div');
            },
            apps: new Proxy(
              {},
              {
                get() {
                  return () => React.createElement('div');
                },
              },
            ),
            appInfoList: [],
          };

          constructor(props: any) {
            super(props);
            const load = async () => {
              try {
                GarfishInstance.setOptions({
                  ...options,
                  insulationVariable: [
                    ...(options.insulationVariable || []),
                    '_SERVER_DATA',
                  ],
                  apps: [],
                });
                const initResult = await promise;
                if (initResult.status === 'rejected') {
                  throw initResult.reason;
                }
                const GarfishConfig = initResult.value;
                const { appInfoList, apps } = generateApps(
                  GarfishConfig,
                  manifest,
                  resolvedTelemetryConfig,
                );
                GarfishInstance.registerApp(appInfoList);
                const MApp = generateMApp(
                  GarfishConfig,
                  manifest,
                  resolvedTelemetryConfig,
                );
                logger('initOptions result', { manifest, GarfishConfig });
                logger('generateApps', { MApp, apps, appInfoList });
                this.setState({
                  MApp,
                  apps,
                  appInfoList,
                });
              } catch (error) {
                emitErrorFallbackTelemetry(
                  {
                    error,
                    phase: inferFallbackPhase(error, 'bootstrap'),
                    metadata: {
                      source: 'plugin-garfish:init',
                    },
                  },
                  resolvedTelemetryConfig,
                );
              }
            };
            load();
          }

          render() {
            logger('GarfishProvider state', this.state);
            return (
              <GarfishProvider value={this.state}>
                <App {...this.props} />
              </GarfishProvider>
            );
          }
        }

        return next({
          App: hoistNonReactStatics(GetMicroFrontendApp, App),
        });
      },
    };
  },
});
