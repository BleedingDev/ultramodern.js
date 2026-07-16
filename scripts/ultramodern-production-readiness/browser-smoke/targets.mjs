import {
  appPort,
  appPortEnv,
  appPublicUrlEnv,
  BrowserSmokeError,
  normalizeSmokeContract,
  routesForApp,
} from './contract.mjs';
import { normalizeBaseUrl } from './http-validate.mjs';

export function inferPublicUrl(app, explicitPublicUrls, env) {
  const explicit = explicitPublicUrls[app.id];
  if (explicit) {
    return explicit;
  }
  const publicUrlEnv = appPublicUrlEnv(app);
  if (publicUrlEnv && env[publicUrlEnv]) {
    return env[publicUrlEnv];
  }
  const workersDevSubdomain = env.ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN;
  const workerName = app.deploy?.cloudflare?.workerName;
  if (workersDevSubdomain && workerName) {
    return `https://${workerName}.${workersDevSubdomain}.workers.dev`;
  }
  return undefined;
}

export function createSmokeTargets(
  contract,
  {
    env = process.env,
    mode = 'local',
    publicUrls = {},
    requirePublicUrls = false,
  } = {},
) {
  const normalizedContract = normalizeSmokeContract(contract);
  const targets = [];
  const skipped = [];

  for (const app of normalizedContract.apps ?? []) {
    const portEnv = appPortEnv(app);
    const configuredPort = portEnv ? env[portEnv] : undefined;
    const port =
      configuredPort === undefined ? appPort(app) : Number(configuredPort);
    let baseUrl;
    if (mode === 'local') {
      if (!Number.isInteger(port) || port <= 0) {
        throw new BrowserSmokeError(`${app.id} is missing a local port`);
      }
      baseUrl = `http://localhost:${port}`;
    } else {
      baseUrl = inferPublicUrl(app, publicUrls, env);
      if (!baseUrl) {
        const skippedEntry = {
          appId: app.id,
          publicUrlEnv: appPublicUrlEnv(app),
          reason: 'public URL is not supplied',
          status: requirePublicUrls ? 'fail' : 'skipped',
        };
        skipped.push(skippedEntry);
        if (requirePublicUrls) {
          throw new BrowserSmokeError(
            `${app.id} requires ${appPublicUrlEnv(app) ?? 'a public URL'}`,
            skippedEntry,
          );
        }
        continue;
      }
    }

    targets.push({
      app,
      baseUrl: normalizeBaseUrl(baseUrl),
      port,
      portEnv,
      publicUrlEnv: appPublicUrlEnv(app),
      routes: routesForApp(app),
    });
  }

  return { skipped, targets };
}

export function orderTargetsForLocalStartup(targets) {
  const remotes = targets.filter(target => target.app.kind !== 'shell');
  const shells = targets.filter(target => target.app.kind === 'shell');
  const pending = new Map(remotes.map(target => [target.app.id, target]));
  const remoteLayers = [];

  while (pending.size > 0) {
    const layer = [...pending.values()].filter(target =>
      (target.app.moduleFederation?.remotes ?? []).every(
        remote => !pending.has(remote.id),
      ),
    );
    if (layer.length === 0) {
      throw new BrowserSmokeError(
        `local smoke remote dependency cycle: ${[...pending.keys()].join(', ')}`,
      );
    }
    remoteLayers.push(layer);
    for (const target of layer) {
      pending.delete(target.app.id);
    }
  }

  const orderedRemotes = remoteLayers.flat();
  return {
    remoteLayers,
    remotes: orderedRemotes,
    shells,
    validation: [...orderedRemotes, ...shells],
  };
}
