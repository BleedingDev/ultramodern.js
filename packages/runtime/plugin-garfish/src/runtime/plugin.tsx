import GarfishInstance from 'garfish';
import React from 'react';
import type { Plugin } from '@modern-js/runtime';
import hoistNonReactStatics from 'hoist-non-react-statics';
import { logger } from '../util';
import { GarfishProvider } from './utils/Context';
import setExternal from './utils/setExternal';
import {
  Config,
  MfFallbackTelemetryConfig,
  Manifest,
  MicroComponentProps,
  ModulesInfo,
  Options,
  RemoteTrustPolicy,
  RuntimeCompatibilityPolicy,
} from './useModuleApps';
import { generateMApp } from './utils/MApp';
import { AppMap, generateApps } from './utils/apps';
import { validateRuntimeCompatibility } from './compatibility';
import { enforceRemoteTrustPolicy } from './trust';
import { emitErrorFallbackTelemetry } from './fallbackTelemetry';
import { applyMfEntryCachePolicy } from './cachePolicy';

async function initOptions(
  manifest: Manifest = {},
  options: Options,
  remoteTrust?: RemoteTrustPolicy,
  runtimeCompatibility?: RuntimeCompatibilityPolicy,
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
  const compatibilityPolicy = compatibilityPolicyCandidate.hostDigest
    ? (compatibilityPolicyCandidate as RuntimeCompatibilityPolicy)
    : undefined;

  const remoteTrustPolicyCandidate: Partial<RemoteTrustPolicy> = {
    ...remoteTrust,
    ...manifest.remoteTrust,
  };
  const remoteTrustPolicy = Object.keys(remoteTrustPolicyCandidate).length
    ? (remoteTrustPolicyCandidate as RemoteTrustPolicy)
    : undefined;
  apps = applyMfEntryCachePolicy(apps, {
    manifestRuntimeDigest: manifest.runtimeDigest,
    globalRuntimeDigest: modernManifest?.runtimeDigest,
  });
  await enforceRemoteTrustPolicy(
    apps,
    remoteTrustPolicy,
  );

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
      ...options
    } = config;
    logger('createPlugin', config);
    const promise = initOptions(
      manifest,
      options,
      remoteTrust,
      runtimeCompatibility,
    );
    const telemetryConfigCandidate: Partial<MfFallbackTelemetryConfig> = {
      ...fallbackTelemetry,
      ...manifest?.fallbackTelemetry,
    };
    const telemetryConfig = Object.keys(telemetryConfigCandidate).length
      ? (telemetryConfigCandidate as MfFallbackTelemetryConfig)
      : undefined;
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
                const GarfishConfig = await promise;
                const { appInfoList, apps } = generateApps(
                  GarfishConfig,
                  manifest,
                  telemetryConfig,
                );
                GarfishInstance.registerApp(appInfoList);
                const MApp = generateMApp(
                  GarfishConfig,
                  manifest,
                  telemetryConfig,
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
                    phase: 'bootstrap',
                    metadata: {
                      source: 'plugin-garfish:init',
                    },
                  },
                  telemetryConfig,
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
