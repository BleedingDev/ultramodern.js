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
    let baseUrl;
    if (mode === 'local') {
      const port = appPort(app);
      if (!Number.isInteger(port)) {
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
      port: appPort(app),
      portEnv: appPortEnv(app),
      publicUrlEnv: appPublicUrlEnv(app),
      routes: routesForApp(app),
    });
  }

  return { skipped, targets };
}

export function orderTargetsForLocalStartup(targets) {
  const remotes = targets.filter(target => target.app.kind !== 'shell');
  const shells = targets.filter(target => target.app.kind === 'shell');
  return { remotes, shells, validation: [...remotes, ...shells] };
}
