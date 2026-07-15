#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Log, LogLevel, Miniflare } from "miniflare";

const workspaceRoot = process.cwd();
const route = "/en";
const fragmentPath = `${route}/_mf/fragment/widget`;
const reportPath = path.join(
  workspaceRoot,
  ".codex/reports/cloudflare-workerd-ssr/composition-proof.json",
);

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};
const readJson = (absolutePath) => JSON.parse(fs.readFileSync(absolutePath, "utf-8"));
const count = (source, value) => source.split(value).length - 1;
const normalizePath = (value) => String(value).replace(/\\/gu, "/");

const collectJavaScriptFiles = (absoluteDirectory) => {
  if (!fs.existsSync(absoluteDirectory)) {
    return [];
  }

  return fs
    .readdirSync(absoluteDirectory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        return collectJavaScriptFiles(absolutePath);
      }
      return entry.isFile() && /\.(?:c|m)?js$/u.test(entry.name) ? [absolutePath] : [];
    })
    .sort();
};

const createWorkerModules = (outputRoot, main) => {
  const entryPath = path.resolve(outputRoot, main);
  const modulePaths = [
    entryPath,
    ...collectJavaScriptFiles(path.join(outputRoot, "server")),
    ...collectJavaScriptFiles(path.join(outputRoot, "worker")),
  ].filter((modulePath, index, paths) => paths.indexOf(modulePath) === index);

  return modulePaths.map((modulePath) => ({
    type: modulePath.endsWith(".cjs") ? "CommonJS" : "ESModule",
    path: modulePath,
  }));
};

const compactConfig = readJson(path.join(workspaceRoot, ".modernjs/ultramodern.json"));
const apps = (compactConfig.topology?.apps ?? []).map((rawApp) => {
  const kind = rawApp.kind === "vertical" ? "vertical" : "shell";
  const appPath =
    typeof rawApp.path === "string"
      ? normalizePath(rawApp.path)
      : kind === "shell"
        ? "apps/shell-super-app"
        : `verticals/${rawApp.id}`;
  const moduleFederation =
    rawApp.moduleFederation && typeof rawApp.moduleFederation === "object"
      ? rawApp.moduleFederation
      : {};
  const outputRoot = path.join(workspaceRoot, appPath, ".output");
  const wranglerPath = path.join(outputRoot, "wrangler.json");
  assert(
    fs.existsSync(wranglerPath),
    `${rawApp.id} Cloudflare output is missing; run pnpm cloudflare:build first`,
  );
  const wrangler = readJson(wranglerPath);

  return {
    id: String(rawApp.id),
    kind,
    path: appPath,
    mfName: typeof moduleFederation.name === "string" ? moduleFederation.name : String(rawApp.id),
    verticalRefs: Array.isArray(moduleFederation.verticalRefs)
      ? moduleFederation.verticalRefs.filter((ref) => typeof ref === "string")
      : [],
    outputRoot,
    wrangler,
  };
});

const shells = apps.filter((app) => app.kind === "shell");
assert(shells.length > 0, "Workerd SSR proof requires at least one shell");
if (process.env.ULTRAMODERN_KEEP_WORKERD === "1") {
  assert(shells.length === 1, "Browser workerd proof requires exactly one shell");
}

const workerName = (app) => {
  assert(
    typeof app.wrangler.name === "string" && app.wrangler.name.length > 0,
    `${app.id} wrangler output must define a worker name`,
  );
  return app.wrangler.name;
};

const createWorkerOptions = (app, extra = {}) => {
  const main = typeof app.wrangler.main === "string" ? app.wrangler.main : "server/index.mjs";
  const assets =
    app.wrangler.assets && typeof app.wrangler.assets === "object" ? app.wrangler.assets : {};
  const directory = typeof assets.directory === "string" ? assets.directory : "./public";

  return {
    name: workerName(app),
    modules: createWorkerModules(app.outputRoot, main),
    modulesRoot: app.outputRoot,
    compatibilityDate: app.wrangler.compatibility_date,
    compatibilityFlags: app.wrangler.compatibility_flags,
    assets: {
      workerName: workerName(app),
      binding: typeof assets.binding === "string" ? assets.binding : "ASSETS",
      directory: path.resolve(app.outputRoot, directory),
      routerConfig: {
        has_user_worker: true,
        invoke_user_worker_ahead_of_assets: assets.run_worker_first !== false,
      },
    },
    ...extra,
  };
};

const proofs = [];

for (const shell of shells) {
  const expectedRemotes = shell.verticalRefs.map((ref) => {
    const remote = apps.find((app) => app.id === ref);
    assert(remote, `${shell.id} references missing MicroVertical ${ref}`);
    return remote;
  });
  assert(expectedRemotes.length > 0, `${shell.id} has no MicroVerticals to prove`);

  const bindingRequests = [];
  const outboundRequests = [];
  const services = Array.isArray(shell.wrangler.services) ? shell.wrangler.services : [];
  const serviceBindings = Object.fromEntries(
    services.map((service) => {
      assert(
        typeof service.binding === "string" && typeof service.service === "string",
        `${shell.id} has an invalid service binding`,
      );
      return [
        service.binding,
        async (request, miniflare) => {
          const requestUrl = new URL(request.url);
          bindingRequests.push({
            binding: service.binding,
            service: service.service,
            pathname: requestUrl.pathname,
          });
          const target = await miniflare.getWorker(service.service);
          return target.fetch(request);
        },
      ];
    }),
  );

  const shellWorker = createWorkerOptions(shell, {
    serviceBindings,
    async outboundService(request) {
      const requestUrl = new URL(request.url);
      outboundRequests.push(requestUrl.href);
      return new Response("External network disabled by SSR proof", {
        status: 502,
      });
    },
  });
  const otherWorkers = apps.filter((app) => app !== shell).map((app) => createWorkerOptions(app));
  const miniflare = new Miniflare({
    log: new Log(LogLevel.ERROR),
    workers: [shellWorker, ...otherWorkers],
  });

  try {
    const response = await miniflare.dispatchFetch(`https://${workerName(shell)}.invalid${route}`, {
      headers: { accept: "text/html" },
    });
    const html = await response.text();
    assert(response.status === 200, `${shell.id} returned HTTP ${response.status} in workerd`);
    assert(
      !html.includes('data-modern-distributed-ssr-status="degraded"'),
      `${shell.id} rendered a degraded MicroVertical fallback in workerd`,
    );

    for (const remote of expectedRemotes) {
      const boundary = `data-modern-boundary-id="${remote.mfName}"`;
      assert(
        count(html, boundary) === 1,
        `${shell.id} must SSR exactly one real ${remote.id} boundary in its raw HTML`,
      );
      assert(
        html.includes('data-modern-mf-expose="./Widget"'),
        `${shell.id} SSR output must contain the MicroVertical Widget expose`,
      );
      assert(
        html.includes(`data-modern-distributed-ssr-boundary="${remote.id}::./Widget"`) &&
          html.includes('data-modern-distributed-ssr-status="ready"'),
        `${shell.id} must mark ${remote.id} as a ready server-composed fragment`,
      );

      const serviceName = workerName(remote);
      const requests = bindingRequests.filter((request) => request.service === serviceName);
      assert(
        requests.length === 1 && requests[0].pathname === fragmentPath,
        `${shell.id} must compose ${remote.id} exactly once through its SSR fragment service binding`,
      );
    }

    assert(
      !outboundRequests.some((url) => /(?:remoteEntry|\.m?js(?:\?|$))/u.test(url)),
      `${shell.id} attempted to fetch remote JavaScript during server composition`,
    );

    proofs.push({
      shellId: shell.id,
      worker: workerName(shell),
      route,
      status: response.status,
      expectedBoundaryIds: expectedRemotes.map((remote) => remote.mfName),
      bindingRequests,
      outboundRequests,
      degradedBoundaryCount: count(html, 'data-modern-distributed-ssr-status="degraded"'),
    });
    if (process.env.ULTRAMODERN_KEEP_WORKERD === "1") {
      console.log(`WORKERD_URL=${await miniflare.ready}`);
      await new Promise((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
    }
  } finally {
    await miniflare.dispose();
  }
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      runtime: "workerd",
      route,
      proofs,
    },
    null,
    2,
  )}\n`,
);
console.log(`Workerd SSR composition proof passed for ${proofs.length} shell(s): ${reportPath}`);
