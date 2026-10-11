import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import { resolveDeployTarget } from '@modern-js/app-tools-extensions/deploy-output/target';
import { SERVICE_WORKER_ENVIRONMENT_NAME } from '@modern-js/builder';
import type { RsbuildPlugin } from '@rsbuild/core';

interface ReactWorkerRscOptions {
  environments: {
    server: string;
    client: string;
  };
}

/** Preserve native options while binding RSC to the existing worker and client. */
export function resolveReactWorkerRscOptions(
  rsc: unknown,
): ReactWorkerRscOptions | undefined {
  if (rsc === undefined || rsc === false) return undefined;
  if (
    rsc !== true &&
    (typeof rsc !== 'object' || rsc === null || Array.isArray(rsc))
  ) {
    throw new TypeError('server.rsc must be a boolean or native RSC options');
  }

  const options = rsc === true ? {} : rsc;
  const environments =
    'environments' in options ? options.environments : undefined;
  if (
    environments !== undefined &&
    (typeof environments !== 'object' ||
      environments === null ||
      Array.isArray(environments))
  ) {
    throw new TypeError('server.rsc.environments must be an object');
  }
  const expected = {
    server: SERVICE_WORKER_ENVIRONMENT_NAME,
    client: 'client',
  };
  for (const role of Object.keys(environments ?? {})) {
    if (role !== 'server' && role !== 'client') {
      throw new TypeError(`Unsupported React RSC environment role: ${role}`);
    }
  }
  const configured = {
    server:
      environments && 'server' in environments
        ? environments.server
        : undefined,
    client:
      environments && 'client' in environments
        ? environments.client
        : undefined,
  };
  for (const role of ['server', 'client'] as const) {
    if (configured[role] !== undefined && configured[role] !== expected[role]) {
      throw new TypeError(
        `Cloudflare React RSC requires environments.${role} to be ${expected[role]}`,
      );
    }
  }
  return { ...options, environments: expected };
}

/** Native RSC global defaults run before this environment configuration hook. */
export function createReactRscWorkerBuilderPlugin(): RsbuildPlugin {
  return {
    name: 'ultramodern:react:rsc-worker',
    setup(api) {
      api.modifyEnvironmentConfig({
        order: 'post',
        handler(config, { name }) {
          if (name !== SERVICE_WORKER_ENVIRONMENT_NAME) return;
          return {
            ...config,
            output: { ...config.output, target: 'web', module: true },
          };
        },
      });
    },
  };
}

/** Registered by the selected React composition, before builder creation. */
export function createReactRscWorkerIntegrationPlugin(): CliPlugin<AppTools> {
  return {
    name: '@modern-js/react-rsc-worker-integration',
    setup(api) {
      api.modifyResolvedConfig(config => {
        if (
          resolveDeployTarget({ configTarget: config.deploy?.target })
            .target !== 'cloudflare' ||
          !config.server?.rsc
        ) {
          return config;
        }
        const rsc = resolveReactWorkerRscOptions(config.server.rsc);
        if (!rsc) return config;
        return {
          ...config,
          server: { ...config.server, rsc },
          builderPlugins: [
            ...(config.builderPlugins ?? []),
            createReactRscWorkerBuilderPlugin(),
          ],
        };
      });
    },
  };
}
