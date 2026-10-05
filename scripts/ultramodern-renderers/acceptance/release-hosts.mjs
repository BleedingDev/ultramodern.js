import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  readCompiledClientModuleGraph,
  readNativeCompilerObservation,
} from './compiler-observation.mjs';
import { probeHttp } from './http.mjs';
import { createNativeHttpProbes } from './native-http-probes.mjs';
import { createReactHttpProbes } from './react-http-probes.mjs';
import { loadInstalledBuildManifest, publicPackageSpecifier } from './run.mjs';

// Starts installed `ultramodern serve`/`ultramodern dev` hosts for packed
// acceptance consumers and derives HTTP probes from their actual build output.
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function fail(message, code = 'C2_HTTP_HOST_AUTHORITY') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function consumerFile(root, input) {
  if (typeof input !== 'string' || !input)
    fail('An explicit consumer file is required');
  const absolute = path.resolve(root, input);
  const relative = path.relative(root, absolute);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    fail(`File is outside the current consumer: ${input}`);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if ((await fs.lstat(current)).isSymbolicLink())
      fail(`Consumer authority cannot use a symlink: ${input}`);
  }
  if (!(await fs.stat(absolute)).isFile())
    fail(`Consumer authority is not a file: ${input}`);
  return absolute;
}

async function readAuthority(root, input) {
  const file = await consumerFile(root, input);
  const bytes = await fs.readFile(file);
  return { file, sha256: digest(bytes), bytes, value: JSON.parse(bytes) };
}

function one(values, label) {
  if (values.length !== 1)
    fail(`${label} must have exactly one actual owning record`);
  return values[0];
}

function routesFlat(routes) {
  if (!Array.isArray(routes)) fail('The emitted route IR must be an array');
  const result = [];
  const visit = route => {
    if (
      !route ||
      typeof route !== 'object' ||
      typeof route.id !== 'string' ||
      !route.id
    )
      fail('The emitted route IR contains a missing opaque route ID');
    result.push(route);
    if (route.children !== undefined) {
      if (!Array.isArray(route.children))
        fail('The emitted route children are malformed');
      route.children.forEach(visit);
    }
  };
  routes.forEach(visit);
  if (new Set(result.map(route => route.id)).size !== result.length)
    fail('The emitted route IR duplicates route IDs');
  return result;
}

function nativeSerializedIR(source) {
  const prefix = 'export const routeIR: FileSystemRouteIR[] = ';
  const suffix = ';\nexport const routeModules:';
  const start = source.indexOf(prefix);
  if (start < 0 || source.indexOf(prefix, start + prefix.length) !== -1)
    fail(
      'The native owning emitter has no unique serialized routeIR initializer',
    );
  const end = source.indexOf(suffix, start + prefix.length);
  if (end < 0)
    fail('The native owning emitter has no routeIR declaration boundary');
  return JSON.parse(source.slice(start + prefix.length, end));
}

function nativeBasepath(source) {
  const matches = [
    ...source.matchAll(/^ {4}basepath: ("(?:[^"\\]|\\.)*"),$/gmu),
  ];
  return JSON.parse(one(matches, 'Native serialized router basepath')[1]);
}

async function routeIds(root, routes, modules, renderer) {
  if (!modules?.page || !modules.control)
    fail(
      'Caller must bind the authored page/control source modules explicitly',
    );
  const expected = {};
  const roles = ['page', 'control', ...(renderer === 'solid' ? ['item'] : [])];
  for (const role of roles)
    expected[role] = await consumerFile(root, modules[role]);
  const records = routesFlat(routes);
  const ids = {};
  const dataModules = [];
  for (const role of roles) {
    const record = one(
      records.filter(route => {
        const component = renderer === 'react' ? route._component : route.file;
        return (
          typeof component === 'string' &&
          path.resolve(root, component) === expected[role]
        );
      }),
      `Emitted ${role} route`,
    );
    const data = renderer === 'react' ? record.data : record.modules?.data;
    if (typeof data !== 'string' || !data)
      fail(`The actual ${role} route has no owning server data module`);
    dataModules.push(path.relative(root, await consumerFile(root, data)));
    ids[role] = record.id;
  }
  if (ids.page === ids.control) fail('Page and control IDs cannot be the same');
  return { ...ids, dataModules };
}

async function productionOctaneCompilerProofs({
  applicationRoot,
  consumerRoot,
  manifest,
  compiler,
}) {
  const require = createRequire(path.join(applicationRoot, 'package.json'));
  const owner = require(
    publicPackageSpecifier('@modern-js/renderer-octane', compiler.kind) +
      '/manifest',
  );
  if (
    typeof owner.octaneModuleManifestFileName !== 'function' ||
    typeof owner.validateOctaneModuleManifest !== 'function'
  )
    fail(
      'Actual installed Octane SDK lacks its public compiler manifest contract',
    );
  const client = one(
    compiler.observation.environments.filter(value => value.name === 'client'),
    'Actual production Octane client compiler',
  );
  const clientBuild = await readAuthority(
    applicationRoot,
    path.join(client.distPath, 'octane-client-build.json'),
  );
  if (
    clientBuild.value.version !== 1 ||
    clientBuild.value.buildId !== client.compilationHash
  )
    fail(
      'Octane public client build metadata is not bound to actual production Stats',
    );
  const files = [{ file: clientBuild.file, sha256: clientBuild.sha256 }];
  const proofs = [];
  for (const [entryName, identity] of Object.entries(manifest.identities)) {
    const record = await readAuthority(
      applicationRoot,
      path.join(client.distPath, owner.octaneModuleManifestFileName(entryName)),
    );
    const value = owner.validateOctaneModuleManifest(
      record.value,
      identity,
      client.compilationHash,
    );
    if (
      value.runtimeVersion !== manifest.profile.hydration.version ||
      value.compilerVersion !== manifest.profile.compiler.version
    )
      fail(
        'Actual Octane module manifest differs from the selected installed profile',
      );
    files.push({ file: record.file, sha256: record.sha256 });
    for (const asset of value.assets) {
      const file = await consumerFile(
        applicationRoot,
        path.join(client.distPath, asset.file),
      );
      const hash = digest(await fs.readFile(file));
      if (hash !== asset.sha256)
        fail(
          'Actual Octane production emitted asset bytes differ from owning compiler manifest',
        );
      files.push({ file, sha256: hash });
    }
    for (const source of value.sourceModules) {
      const requested = source.resource.split('?')[0];
      const file = await fs.realpath(path.resolve(applicationRoot, requested));
      const relative = path.relative(consumerRoot, file);
      if (
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative) ||
        !(await fs.stat(file)).isFile()
      )
        fail(
          'Actual Octane production source resolves outside the clean consumer',
        );
      const hash = digest(await fs.readFile(file));
      if (hash !== source.sourceSha256)
        fail(
          'Current Octane source differs from its authentic production compiler record',
        );
      files.push({ file, sha256: hash });
    }
    proofs.push({
      entryName,
      manifestPath: path.relative(consumerRoot, record.file),
    });
  }
  return {
    proofs,
    files,
    authority: {
      mode: 'production',
      sourceAdmission: 'current-installed-raw-sources',
      emissionAdmission: 'actual-production-assets',
      developmentEmissionAdmission: false,
      clientCompilationHash: client.compilationHash,
    },
  };
}

function documentHead(nodes) {
  const root = one(
    nodes.filter(node => node.name === 'html'),
    'Observed document html root',
  );
  const head = one(
    nodes.filter(node => node.name === 'head'),
    'Observed HTML head',
  );
  if (root.parent || head.parent !== root)
    fail('Observed head is not a direct HTML document child');
  return head;
}

function stylesFromHead(html) {
  const nodes = markupNodes(html);
  const head = documentHead(nodes);
  const styles = [];
  for (const node of nodes) {
    if (node.name !== 'link' || node.parent !== head) continue;
    const rel = node.attributes.rel?.toLowerCase().split(/\s+/u) ?? [];
    if (rel.includes('stylesheet') && node.attributes.href)
      styles.push(node.attributes.href);
  }
  if (new Set(styles).size !== styles.length)
    fail('The actual emitted HTML head duplicates startup stylesheet URLs');
  return [...new Set(styles)];
}

/** Actual getAssets closure, never a DOM-derived expected loaded set. */
export function compilerCSSAuthority({
  compiler,
  identity,
  headIncludes,
  environment,
}) {
  const closure = compiler.clientStylesheets;
  if (
    !closure ||
    closure.evidence !== 'stats.compilation.getAssets' ||
    !Array.isArray(closure.assets) ||
    !Array.isArray(closure.startupFiles?.[identity.entryName])
  )
    fail('Actual client CSS closure/startup entry is absent');
  const publicPath = closure.publicPath;
  if (
    typeof publicPath !== 'string' ||
    publicPath === 'auto' ||
    !/^(?:https?:\/\/|\/)/u.test(publicPath)
  )
    fail(
      'Actual compiler CSS publicPath must independently resolve to an absolute host/CDN prefix; auto/relative cannot substantiate URL authority',
    );
  const base = new URL(publicPath, 'https://compiler-css-authority.invalid');
  if (base.search || base.hash || base.username || base.password)
    fail('Actual CSS publicPath has ambiguous URL components');
  const prefix = publicPath.endsWith('/') ? publicPath : `${publicPath}/`;
  const compiledCssAssets = closure.assets.map(asset => ({
    ...asset,
    href: `${prefix}${asset.file}`,
  }));
  if (
    new Set(compiledCssAssets.map(asset => asset.href)).size !==
    compiledCssAssets.length
  )
    fail('Actual CSS closure duplicates public URLs');
  if (
    !Array.isArray(headIncludes) ||
    new Set(headIncludes).size !== headIncludes.length
  )
    fail('Actual document CSS startup URLs must be explicit and unique');
  const relativeURL = href =>
    new URL(href, 'https://compiler-css-authority.invalid/').href;
  if (
    !headIncludes.every(href =>
      compiledCssAssets.some(
        asset => relativeURL(asset.href) === relativeURL(href),
      ),
    )
  )
    fail('Actual document startup CSS is outside completed compiler closure');
  const startupStylesheetUrls = [...headIncludes];
  const compilerStartup = closure.startupFiles[identity.entryName].map(
    file => compiledCssAssets.find(asset => asset.file === file)?.href,
  );
  if (
    compilerStartup.some(
      href =>
        !href ||
        !startupStylesheetUrls.some(
          actual => relativeURL(actual) === relativeURL(href),
        ),
    )
  )
    fail('Actual document omitted an emitted entry startup stylesheet');
  return {
    mode: environment,
    compilationHash: closure.compilationHash,
    closureSha256: closure.sha256,
    publicPath,
    outputPath: closure.outputPath,
    compiledCssAssets,
    startupStylesheetUrls,
  };
}

function baseFromHead(html) {
  const nodes = markupNodes(html);
  const head = documentHead(nodes);
  const bases = nodes.filter(
    node => node.name === 'base' && Object.hasOwn(node.attributes, 'href'),
  );
  if (bases.some(node => node.parent !== head))
    fail('Observed document has a base outside its eligible head context');
  return bases[0]?.attributes.href;
}

async function abortBounded(signal, operation) {
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return operation();
      }),
      aborted,
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Read actual after-build authority. Caller authenticates metadataFile to the
 * configured output before the single build; the manifest does not encode a
 * configured output directory. No app imports, route generation or host start.
 */
export async function readConformanceHostAuthority({
  row,
  manifest,
  environment = 'production',
  entryName,
}) {
  if (!['production', 'development'].includes(environment))
    fail('Unknown host phase');
  if (environment === 'development')
    fail(
      'Development authority requires the owning normal dev process and its post-start public checkpoint/observer/HTTP readiness; use attachConformanceHosts',
      'C2_DEVELOPMENT_HOST_REQUIRED',
    );
  const consumerRoot = await fs.realpath(row.consumerRoot);
  const applicationRoot = await fs.realpath(
    path.resolve(consumerRoot, row.applicationRoot ?? '.'),
  );
  const relation = path.relative(consumerRoot, applicationRoot);
  if (
    relation === '..' ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  )
    fail('Application root escapes its consumer');
  const metadataFile = row.environments?.[environment]?.metadataFile;
  const metadata = await readAuthority(
    applicationRoot,
    path.resolve(consumerRoot, metadataFile ?? ''),
  );
  if (
    path.basename(metadata.file) !== 'renderer-build.json' ||
    path.basename(path.dirname(metadata.file)) === '.ultramodern-dev' ||
    !isDeepStrictEqual(metadata.value, manifest)
  )
    fail(
      'Provided manifest does not equal the actual canonical emitted manifest',
    );
  if (
    manifest.schema !== 'ultramodern-renderer-build' ||
    manifest.version !== 1 ||
    manifest.profile?.renderer !== row.renderer
  )
    fail('The actual emitted manifest does not bind this renderer');
  await loadInstalledBuildManifest({
    applicationRoot,
    metadata: metadata.value,
    renderer: row.renderer,
    kind: row.kind,
  });
  const distDirectory = path.dirname(metadata.file);
  const serverRoutes = await readAuthority(
    applicationRoot,
    path.join(distDirectory, 'route.json'),
  );
  if (!Array.isArray(serverRoutes.value.routes))
    fail('The analyzed route.json has no serverRoutes array');
  const owning = serverRoutes.value.routes.filter(
    route =>
      !route.isApi && Object.hasOwn(manifest.identities, route.entryName),
  );
  const ssrRoute = one(
    owning.filter(route => route.isSSR === true),
    'Analyzed SSR entry',
  );
  const csrRoute = one(
    owning.filter(route => route.isSSR === false),
    'Analyzed CSR entry',
  );
  const selectedRoute =
    entryName === undefined
      ? ssrRoute
      : one(
          owning.filter(route => route.entryName === entryName),
          'Selected analyzed entry',
        );
  const ssrIdentity = manifest.identities[ssrRoute.entryName];
  const identity = manifest.identities[selectedRoute.entryName];
  const csrIdentity = manifest.identities[csrRoute.entryName];
  if (
    ssrIdentity.renderer !== row.renderer ||
    csrIdentity.renderer !== row.renderer ||
    ssrIdentity.entryName === csrIdentity.entryName ||
    ssrIdentity.buildId !== manifest.buildMarker ||
    csrIdentity.buildId !== manifest.buildMarker
  )
    fail(
      'Analyzed SSR/CSR entries disagree with their actual built identities',
    );
  const routePrefix = selectedRoute.urlPath;
  const files = [metadata, serverRoutes];
  let routeIR;
  let headIncludes;
  let compiler;
  if (row.renderer === 'react') {
    const ir = await readAuthority(
      applicationRoot,
      path.join(distDirectory, 'nestedRoutes.json'),
    );
    routeIR = ir.value[identity.entryName];
    files.push(ir);
    const htmlFile = await consumerFile(
      applicationRoot,
      path.resolve(distDirectory, selectedRoute.entryPath),
    );
    const htmlBytes = await fs.readFile(htmlFile);
    headIncludes = stylesFromHead(htmlBytes.toString('utf8'));
    files.push({ file: htmlFile, sha256: digest(htmlBytes) });
    const assets = await readAuthority(
      applicationRoot,
      path.join(distDirectory, 'routes-manifest.json'),
    );
    const css = Object.values(assets.value.routeAssets ?? {}).flatMap(
      record => record.referenceCssAssets ?? [],
    );
    if (!headIncludes.every(href => css.includes(href)))
      fail(
        'Emitted React head styles are not corroborated by actual route assets',
      );
    files.push(assets);
  } else {
    compiler = await readNativeCompilerObservation({
      applicationRoot,
      consumerRoot,
      distDirectory,
      renderer: row.renderer,
      expectedEntryNames: Object.keys(manifest.identities),
    });
    const server = one(
      compiler.observation.environments.filter(
        value => value.name === 'server',
      ),
      'Completed native server compiler',
    );
    const root = one(
      server.entry[identity.entryName].filter(
        file => path.basename(file) === 'index.server.ts',
      ),
      'Actual native server root',
    );
    const irFile = await consumerFile(
      applicationRoot,
      path.join(path.dirname(root), 'routes.server.ts'),
    );
    const bytes = await fs.readFile(irFile);
    const source = bytes.toString('utf8');
    routeIR = nativeSerializedIR(source);
    if (nativeBasepath(source) !== routePrefix)
      fail(
        'Serialized native basepath differs from its actual analyzed server prefix',
      );
    files.push({ file: irFile, sha256: digest(bytes) });
    const assets = await readAuthority(
      applicationRoot,
      path.join(distDirectory, 'renderer-assets.json'),
    );
    const entry = assets.value.entries?.[identity.entryName];
    if (
      assets.value.schema !== 'ultramodern-renderer-assets' ||
      assets.value.version !== 1 ||
      !isDeepStrictEqual(entry?.rendererIdentity, identity)
    )
      fail('Native document assets have a different owning identity');
    headIncludes = (entry.assets ?? [])
      .filter(asset => asset.kind === 'stylesheet')
      .map(asset => asset.href);
    files.push(assets);
  }
  if (row.renderer === 'react')
    compiler = await readCompiledClientModuleGraph({
      applicationRoot,
      consumerRoot,
      distDirectory,
      renderer: row.renderer,
      expectedEntryNames: Object.keys(manifest.identities),
    });
  const cssAuthority = compilerCSSAuthority({
    compiler,
    identity,
    headIncludes,
    environment,
  });
  const nativeProof =
    row.renderer === 'octane'
      ? await productionOctaneCompilerProofs({
          applicationRoot,
          consumerRoot,
          manifest,
          compiler: { ...compiler, kind: row.kind },
        })
      : undefined;
  if (nativeProof) files.push(...nativeProof.files);
  const ids = await routeIds(
    applicationRoot,
    routeIR,
    row.routeModules?.[identity.entryName],
    row.renderer,
  );
  return {
    applicationRoot,
    consumerRoot,
    distDirectory,
    metadataFile: path.relative(consumerRoot, metadata.file),
    identity,
    csrIdentity,
    routePrefix,
    csrRoutePrefix: csrRoute.urlPath,
    pageRouteId: ids.page,
    controlRouteId: ids.control,
    ...(ids.item ? { itemRouteId: ids.item } : {}),
    serverDataModules: ids.dataModules,
    headIncludes,
    cssAuthority,
    compilerObservation: compiler,
    ...(nativeProof
      ? {
          nativeCompilerManifests: nativeProof.proofs,
          nativeCompilerAuthority: nativeProof.authority,
        }
      : {}),
    files: files.map(({ file, sha256 }) => ({ file, sha256 })),
  };
}

function developmentOwner(applicationRoot, kind) {
  const require = createRequire(path.join(applicationRoot, 'package.json'));
  const owner = require(
    publicPackageSpecifier('@modern-js/ultramodern-app-tools', kind),
  );
  if (
    typeof owner.resolveRendererProfile !== 'function' ||
    typeof owner.readRendererDevelopmentBuildManifest !== 'function' ||
    typeof owner.validateRendererDevelopmentBuildManifest !== 'function'
  )
    fail(
      'Installed framework lacks its public development manifest reader/validator',
      'C2_DEVELOPMENT_METADATA_UNAVAILABLE',
    );
  return owner;
}

async function statCheckpoint(file) {
  try {
    const value = await fs.stat(file, { bigint: true });
    return { ino: value.ino, mtimeNs: value.mtimeNs, size: value.size };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readBoundedBody(response, signal, limit = 8 * 1024 * 1024) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks);
      size += value.byteLength;
      if (size > limit)
        fail(
          'Actual development document/asset exceeds the observation budget',
        );
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function observeDevelopmentDocument({
  baseUrl,
  routePrefix,
  identity,
  signal,
}) {
  const documentUrl = new URL(`${routePrefix.replace(/\/$/u, '')}/`, baseUrl);
  const response = await fetch(documentUrl, { redirect: 'manual', signal });
  try {
    if (
      response.status !== 200 ||
      !response.headers.get('content-type')?.includes('text/html')
    )
      fail('Development document is not successful HTML');
    const observedIdentity = JSON.parse(
      response.headers.get('x-ultramodern-renderer-identity') ?? 'null',
    );
    if (!isDeepStrictEqual(observedIdentity, identity))
      fail(
        'Development document header differs from its actual current development checkpoint',
      );
    const body = await readBoundedBody(response, signal);
    const html = body.toString('utf8');
    const headIncludes = stylesFromHead(html);
    const baseHref = baseFromHead(html);
    const stylesheetBaseUrl =
      baseHref === undefined ? documentUrl : new URL(baseHref, documentUrl);
    const styles = [];
    for (const href of headIncludes) {
      const url = new URL(href, stylesheetBaseUrl);
      if (
        url.origin !== new URL(baseUrl).origin ||
        !['http:', 'https:'].includes(url.protocol)
      )
        fail(
          'Development fixture stylesheet must be served by its actual host',
        );
      const asset = await fetch(url, { redirect: 'manual', signal });
      try {
        if (
          asset.status !== 200 ||
          !asset.headers.get('content-type')?.includes('text/css')
        )
          fail(
            'Development head stylesheet is not an actual successful CSS response',
          );
        const bytes = await readBoundedBody(asset, signal);
        if (!bytes.length)
          fail('Development head stylesheet has no emitted bytes');
        styles.push({
          href,
          url: url.href,
          status: asset.status,
          contentType: asset.headers.get('content-type'),
          sha256: digest(bytes),
          bytes: bytes.byteLength,
        });
      } finally {
        await asset.body?.cancel().catch(() => {});
      }
    }
    return {
      observedIdentity,
      headIncludes,
      document: {
        url: documentUrl.href,
        baseHref,
        status: response.status,
        bodySha256: digest(body),
        styles,
      },
    };
  } finally {
    await response.body?.cancel().catch(() => {});
  }
}

async function readDevelopmentHostAuthority({
  row,
  production,
  initialCheckpoint,
  startedAt,
  baseUrl,
  signal,
  entryName,
  expectedIdentity,
}) {
  signal.throwIfAborted();
  const { applicationRoot, consumerRoot, distDirectory } = production;
  const expectedMetadataFile = path.join(
    distDirectory,
    '.ultramodern-dev',
    'renderer-build.json',
  );
  if (
    typeof row.environments?.development?.metadataFile !== 'string' ||
    path.resolve(consumerRoot, row.environments.development.metadataFile) !==
      expectedMetadataFile
  )
    fail(
      'Development metadataFile must be the owning fixed checkpoint beneath the actual configured dist directory',
    );
  const metadata = await readAuthority(applicationRoot, expectedMetadataFile);
  const currentCheckpoint = await statCheckpoint(metadata.file);
  if (
    !currentCheckpoint ||
    (expectedIdentity === undefined &&
      (isDeepStrictEqual(currentCheckpoint, initialCheckpoint) ||
        currentCheckpoint.mtimeNs < BigInt(startedAt - 1_000) * 1_000_000n))
  )
    fail(
      'Development checkpoint has not been committed by the current normal dev startup',
    );
  const owner = developmentOwner(applicationRoot, row.kind);
  const profile = owner.resolveRendererProfile(row.renderer);
  const manifest = await owner.readRendererDevelopmentBuildManifest(
    distDirectory,
    profile,
  );
  const validated = owner.validateRendererDevelopmentBuildManifest(
    metadata.value,
    profile,
  );
  if (
    !isDeepStrictEqual(manifest, validated) ||
    !isDeepStrictEqual(manifest, metadata.value)
  )
    fail('Development checkpoint changed during its public read/validation');
  if (
    !isDeepStrictEqual(
      Object.keys(manifest.identities).sort(),
      Object.keys(production.manifest.identities).sort(),
    )
  )
    fail(
      'Development entry set differs from the authorized authored application',
    );
  for (const key of [
    'sourceRevision',
    'compilerDigest',
    'frameworkCohortDigest',
  ])
    if (manifest[key] !== production.manifest[key])
      fail(
        `Development checkpoint differs from the bound installed production cohort (${key})`,
      );
  const routes = await readAuthority(
    applicationRoot,
    path.join(distDirectory, 'route.json'),
  );
  if (!Array.isArray(routes.value.routes))
    fail('Normal dev analyzed route.json has no serverRoutes array');
  const owning = routes.value.routes.filter(
    route =>
      !route.isApi && Object.hasOwn(manifest.identities, route.entryName),
  );
  const ssr = one(
    owning.filter(route => route.isSSR === true),
    'Development analyzed SSR entry',
  );
  const csr = one(
    owning.filter(route => route.isSSR === false),
    'Development analyzed CSR entry',
  );
  const selectedRoute =
    entryName === undefined
      ? ssr
      : one(
          owning.filter(route => route.entryName === entryName),
          'Selected current development entry',
        );
  const identity = manifest.identities[selectedRoute.entryName];
  const csrIdentity = manifest.identities[csr.entryName];
  if (
    expectedIdentity !== undefined &&
    !isDeepStrictEqual(identity, expectedIdentity)
  )
    fail(
      'Current development identity differs from the attached owning host session',
    );
  const files = [metadata, routes].map(({ file, sha256 }) => ({
    file,
    sha256,
  }));
  let routeIR;
  let compiler;
  if (row.renderer === 'react') {
    const ir = await readAuthority(
      applicationRoot,
      path.join(distDirectory, 'nestedRoutes.json'),
    );
    routeIR = ir.value[identity.entryName];
    files.push({ file: ir.file, sha256: ir.sha256 });
  } else {
    compiler = await readNativeCompilerObservation({
      applicationRoot,
      consumerRoot,
      distDirectory,
      renderer: row.renderer,
      expectedEntryNames: Object.keys(manifest.identities),
      environment: 'development',
      expectedDevelopmentManifest: manifest,
    });
    const server = one(
      compiler.observation.environments.filter(
        value => value.name === 'server',
      ),
      'Current native development server compiler',
    );
    const root = one(
      server.entry[identity.entryName].filter(
        file => path.basename(file) === 'index.server.ts',
      ),
      'Actual current native development server root',
    );
    const irFile = await consumerFile(
      applicationRoot,
      path.join(path.dirname(root), 'routes.server.ts'),
    );
    const inventory = one(
      compiler.sourceInventory.filter(
        value =>
          value.absolute === irFile &&
          value.roles.includes('environment:server:route-ir'),
      ),
      'Actual current native development route IR inventory',
    );
    const bytes = await fs.readFile(irFile);
    if (digest(bytes) !== inventory.sha256)
      fail(
        'Current native development route IR differs from its compiler observation',
      );
    const source = bytes.toString('utf8');
    routeIR = nativeSerializedIR(source);
    if (nativeBasepath(source) !== selectedRoute.urlPath)
      fail(
        'Current native development basepath differs from its actual analyzed prefix',
      );
    files.push(
      { file: irFile, sha256: inventory.sha256 },
      { file: compiler.receiptPath, sha256: compiler.receiptSha256 },
    );
  }
  if (row.renderer === 'react')
    compiler = await readCompiledClientModuleGraph({
      applicationRoot,
      consumerRoot,
      distDirectory,
      renderer: row.renderer,
      expectedEntryNames: Object.keys(manifest.identities),
      environment: 'development',
      expectedDevelopmentManifest: manifest,
    });
  const ids = await routeIds(
    applicationRoot,
    routeIR,
    row.routeModules?.[identity.entryName],
    row.renderer,
  );
  const observed = await observeDevelopmentDocument({
    baseUrl,
    routePrefix: selectedRoute.urlPath,
    identity,
    signal,
  });
  const cssAuthority = compilerCSSAuthority({
    compiler,
    identity,
    headIncludes: observed.headIncludes,
    environment: 'development',
  });
  const compiledByURL = new Map(
    cssAuthority.compiledCssAssets.map(asset => [
      new URL(asset.href, baseUrl).href,
      asset,
    ]),
  );
  for (const style of observed.document.styles) {
    const expected = compiledByURL.get(style.url);
    if (
      !expected ||
      expected.sha256 !== style.sha256 ||
      expected.size !== style.bytes
    )
      fail(
        'Actual dev startup CSS HTTP bytes differ from current completed compiler-memory CSS closure',
      );
  }
  for (const file of [...files, ...production.preserveFiles])
    if (digest(await fs.readFile(file.file)) !== file.sha256)
      fail(
        'Development startup authority or the canonical production manifest changed during readiness',
      );
  return {
    applicationRoot,
    consumerRoot,
    distDirectory,
    manifest,
    metadataFile: path.relative(consumerRoot, metadata.file),
    identity,
    csrIdentity,
    routePrefix: selectedRoute.urlPath,
    csrRoutePrefix: csr.urlPath,
    pageRouteId: ids.page,
    controlRouteId: ids.control,
    ...(ids.item ? { itemRouteId: ids.item } : {}),
    serverDataModules: ids.dataModules,
    headIncludes: observed.headIncludes,
    cssAuthority,
    document: observed.document,
    devCompilation: manifest.devCompilation,
    compilerObservation: compiler,
    files,
    preserveFiles: production.preserveFiles,
  };
}

function capturedEntryAuthority(authority) {
  const compiler = authority.compilerObservation;
  return {
    captureEnvironment: 'production',
    metadataFile: authority.metadataFile,
    identity: authority.identity,
    routePrefix: authority.routePrefix,
    csrRoutePrefix: authority.csrRoutePrefix,
    pageRouteId: authority.pageRouteId,
    controlRouteId: authority.controlRouteId,
    ...(authority.itemRouteId ? { itemRouteId: authority.itemRouteId } : {}),
    serverDataModules: authority.serverDataModules,
    headIncludes: authority.headIncludes,
    cssAuthority: authority.cssAuthority,
    files: authority.files,
    compilerObservation: {
      receiptPath: compiler.receiptPath,
      receiptSha256: compiler.receiptSha256,
      clientModuleGraph: compiler.clientModuleGraph,
      compiledModuleResources: compiler.compiledModuleResources,
    },
  };
}

/** Select an actual attached entry, retaining build-time production authority. */
export async function readCurrentConformanceEntryAuthority({
  row,
  host,
  environment,
  entryName,
  signal,
}) {
  signal.throwIfAborted();
  if (!['production', 'development'].includes(environment))
    fail('Unknown selected-entry environment');
  const expectedIdentity = [host.identity, host.csrIdentity].find(
    identity => identity?.entryName === entryName,
  );
  if (!expectedIdentity || expectedIdentity.renderer !== row.renderer)
    fail('Selected entry is absent from the actual attached host identities');
  const consumerRoot = await fs.realpath(row.consumerRoot);
  const applicationRoot = await fs.realpath(
    path.resolve(consumerRoot, row.applicationRoot ?? '.'),
  );
  const metadata = await readAuthority(
    applicationRoot,
    path.resolve(consumerRoot, row.environments.production.metadataFile),
  );
  const manifest = await loadInstalledBuildManifest({
    applicationRoot,
    metadata: metadata.value,
    renderer: row.renderer,
    kind: row.kind,
    environment: 'production',
  });
  if (environment === 'production') {
    const captured = host.entryAuthorities?.[entryName];
    if (!captured || captured.captureEnvironment !== 'production')
      fail(
        `Missing pre-development production host.entryAuthorities.${entryName}; attach hosts with captureCsrAuthority`,
        'C53_CSR_PRODUCTION_AUTHORITY_REQUIRED',
      );
    if (
      !isDeepStrictEqual(captured.identity, expectedIdentity) ||
      !isDeepStrictEqual(manifest.identities[entryName], expectedIdentity) ||
      path.resolve(consumerRoot, captured.metadataFile) !== metadata.file ||
      !captured.files.some(
        file => file.file === metadata.file && file.sha256 === metadata.sha256,
      )
    )
      fail(
        'Captured production entry differs from its canonical build identity',
      );
    const receipt = await readAuthority(
      applicationRoot,
      captured.compilerObservation.receiptPath,
    );
    if (receipt.sha256 !== captured.compilerObservation.receiptSha256)
      fail(
        'Captured production compiler receipt changed after host attachment',
      );
    return captured;
  }
  const authority = await readDevelopmentHostAuthority({
    row,
    production: {
      applicationRoot,
      consumerRoot,
      distDirectory: path.dirname(metadata.file),
      manifest,
      preserveFiles: [{ file: metadata.file, sha256: metadata.sha256 }],
    },
    baseUrl: host.baseUrl,
    signal,
    entryName,
    expectedIdentity,
  });
  const attachedIdentities = Object.fromEntries(
    [host.identity, host.csrIdentity].map(identity => [
      identity.entryName,
      identity,
    ]),
  );
  if (!isDeepStrictEqual(authority.manifest.identities, attachedIdentities))
    fail(
      'Current entry identities differ from the attached development session',
    );
  return authority;
}

async function requireInstalledCli(installedCli) {
  if (
    !installedCli?.path ||
    !installedCli.packageJsonPath ||
    !installedCli.binName
  )
    fail('Explicit validated installed CLI bin authority is required');
  const packageFile = await fs.realpath(installedCli.packageJsonPath);
  const owner = JSON.parse(await fs.readFile(packageFile, 'utf8'));
  const declared =
    typeof owner.bin === 'string'
      ? owner.bin
      : owner.bin?.[installedCli.binName];
  if (typeof declared !== 'string')
    fail('Installed package does not declare the selected CLI bin');
  const cli = await fs.realpath(installedCli.path);
  if (
    cli !==
      (await fs.realpath(path.resolve(path.dirname(packageFile), declared))) ||
    !(await fs.stat(cli)).isFile()
  )
    fail('CLI path does not equal its actual installed package bin');
  return cli;
}

async function requireFreePort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    fail('An explicit local port from the supervisor is required');
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve())),
  );
}

async function startIdentityBoundHost({
  authority,
  qualifiedNode,
  env,
  port,
  installedCli,
  logsDirectory: ownedLogsDirectory,
  label,
  environment = 'production',
  resolveReadyAuthority,
  signal: borrowedSignal,
  readyTimeoutMs = 60_000,
  lifetimeMs = 900_000,
}) {
  if (borrowedSignal !== undefined && !(borrowedSignal instanceof AbortSignal))
    fail('Supervisor signal must be an actual AbortSignal');
  borrowedSignal?.throwIfAborted();
  if (
    !path.isAbsolute(qualifiedNode ?? '') ||
    !(await fs.stat(qualifiedNode)).isFile()
  )
    fail('The actual qualified Node executable is required');
  if (!env || typeof env !== 'object')
    fail('Caller must supply the actual host environment');
  if (
    !['production', 'development'].includes(environment) ||
    (environment === 'development' &&
      typeof resolveReadyAuthority !== 'function')
  )
    fail('Development host requires its real post-start authority reader');
  if (
    !Number.isInteger(readyTimeoutMs) ||
    readyTimeoutMs <= 0 ||
    readyTimeoutMs > 60_000 ||
    !Number.isInteger(lifetimeMs) ||
    lifetimeMs < readyTimeoutMs ||
    lifetimeMs > 14_400_000
  )
    fail(
      'Host readiness/lifetime must have bounded deadlines (lifetime maximum four hours)',
    );
  const cli = await requireInstalledCli(installedCli);
  await requireFreePort(port);
  const logsDirectory = await fs.realpath(ownedLogsDirectory);
  if (!(await fs.stat(logsDirectory)).isDirectory())
    fail('Supervisor must own the existing host log directory');
  const logFile = path.join(logsDirectory, `c2-${label}-${randomUUID()}.log`);
  borrowedSignal?.throwIfAborted();
  const output = createWriteStream(logFile, { flags: 'wx' });
  await new Promise((resolve, reject) => {
    output.once('open', resolve);
    output.once('error', reject);
  });
  const hash = createHash('sha256');
  let tail = '';
  let length = 0;
  let failure;
  let child;
  let close;
  let lifetime;
  let stopPromise;
  let stopping = false;
  let onAbort;
  const signalGroup = name => {
    if (!child?.pid) return;
    try {
      process.kill(-child.pid, name);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const groupExists = () => {
    if (!child?.pid) return false;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  const waitForGroup = async timeoutMs => {
    const deadline = Date.now() + timeoutMs;
    while (groupExists() && Date.now() < deadline) await delay(25);
    return !groupExists();
  };
  const stop = () =>
    (stopPromise ??= (async () => {
      stopping = true;
      clearTimeout(lifetime);
      if (onAbort) borrowedSignal.removeEventListener('abort', onAbort);
      const cleanupErrors = [];
      try {
        signalGroup('SIGTERM');
        if (!(await waitForGroup(2_000))) signalGroup('SIGKILL');
        if (!(await waitForGroup(2_000)))
          throw new Error(
            'Owned host process group did not stop after SIGKILL',
          );
        if (close)
          await Promise.race([
            close,
            delay(2_000).then(() => {
              throw new Error(
                'Owned host streams did not close before their deadline',
              );
            }),
          ]);
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        if (!output.closed) {
          const closed = new Promise(resolve => output.once('close', resolve));
          output.end();
          const finished = await Promise.race([
            closed.then(() => true),
            delay(2_000).then(() => false),
          ]);
          if (!finished) output.destroy();
          await Promise.race([
            closed,
            delay(2_000).then(() => {
              throw new Error(
                'Owned host log did not close before its deadline',
              );
            }),
          ]);
        }
      } catch (error) {
        cleanupErrors.push(error);
        output.destroy();
      } finally {
        try {
          await fs.rm(logFile, { force: true });
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length)
        throw new AggregateError(cleanupErrors, 'Owned host cleanup failed');
      return { sha256: hash.digest('hex'), tail, bytes: length };
    })());
  const retireAfterFailure = error => {
    failure ??= error;
    void stop().catch(cleanupError => {
      failure = new AggregateError(
        [failure, cleanupError],
        'Owned host failure and cleanup failed',
      );
    });
  };
  if (borrowedSignal) {
    onAbort = () =>
      retireAfterFailure(
        borrowedSignal.reason instanceof Error
          ? borrowedSignal.reason
          : new Error('Host supervision cancelled', {
              cause: borrowedSignal.reason,
            }),
      );
    borrowedSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    borrowedSignal?.throwIfAborted();
    const startedAt = Date.now();
    child = spawn(
      qualifiedNode,
      [cli, environment === 'development' ? 'dev' : 'serve'],
      {
        cwd: authority.applicationRoot,
        env: { ...env, NODE_ENV: environment, PORT: String(port) },
        detached: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    close = new Promise(resolve => {
      child.once('error', error => {
        failure = error;
        resolve();
      });
      child.once('close', (code, exitSignal) => {
        if (!stopping)
          failure ??= new Error(`Owned host exited (${code ?? exitSignal})`);
        resolve();
      });
    });
    output.on('error', retireAfterFailure);
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', bytes => {
        length += bytes.length;
        hash.update(bytes);
        tail = `${tail}${bytes.toString('utf8')}`.slice(-4_096);
        if (length > 8 * 1024 * 1024)
          retireAfterFailure(
            new Error('Owned host exceeded its bounded log budget'),
          );
        else if (!output.destroyed && !output.writableEnded)
          output.write(bytes);
      });
    lifetime = setTimeout(
      () =>
        retireAfterFailure(
          new Error('Owned host exceeded its bounded lifetime'),
        ),
      lifetimeMs,
    );
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + readyTimeoutMs;
    let ready = false;
    let observedIdentity;
    let currentAuthority = authority;
    let lastReadinessError;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      try {
        const timeoutSignal = AbortSignal.timeout(
          Math.min(1_000, Math.max(1, deadline - Date.now())),
        );
        const readinessSignal = borrowedSignal
          ? AbortSignal.any([borrowedSignal, timeoutSignal])
          : timeoutSignal;
        if (resolveReadyAuthority)
          currentAuthority = await abortBounded(readinessSignal, () =>
            resolveReadyAuthority(baseUrl, {
              startedAt,
              signal: readinessSignal,
            }),
          );
        const response = await fetch(
          `${baseUrl}${currentAuthority.routePrefix.replace(/\/$/u, '')}/`,
          { redirect: 'manual', signal: readinessSignal },
        );
        try {
          const actual = JSON.parse(
            response.headers.get('x-ultramodern-renderer-identity') ?? 'null',
          );
          ready =
            response.status === 200 &&
            isDeepStrictEqual(actual, currentAuthority.identity);
          if (ready) observedIdentity = actual;
        } finally {
          await response.body?.cancel();
        }
        if (ready) break;
      } catch (error) {
        lastReadinessError = error;
        if (failure) throw failure;
      }
      await delay(50);
    }
    if (!ready || failure)
      throw (
        failure ??
        new Error(
          `Owned host did not become identity-bound ready before its deadline${lastReadinessError ? `: ${lastReadinessError.message ?? String(lastReadinessError)}` : ''}`,
          { cause: lastReadinessError },
        )
      );
    for (const file of [
      ...currentAuthority.files,
      ...(currentAuthority.preserveFiles ?? []),
    ])
      if (digest(await fs.readFile(file.file)) !== file.sha256)
        fail(
          'Actual host authority or canonical production manifest changed during startup',
        );
    borrowedSignal?.throwIfAborted();
    return {
      baseUrl,
      authority: currentAuthority,
      observedIdentity,
      pid: child.pid,
      logFile,
      stop,
      exited: close,
      get failure() {
        return failure;
      },
    };
  } catch (cause) {
    const error =
      cause instanceof Error
        ? cause
        : new Error('Owned host startup failed', { cause });
    try {
      error.hostLog = await stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Owned host startup and cleanup failed',
      );
    }
    throw error;
  }
}

/**
 * Start one normal installed host phase only when the supervisor invokes this.
 * executeCommand is deliberately unused because the runner executor waits for exit.
 * Caller owns the existing log directory and application/build trees. stop() removes
 * only this handle's unique log and returns its SHA/tail. Development waits for
 * its own canonical checkpoint, actual compiler observation and live document.
 */
export async function attachConformanceHosts({
  row,
  manifest,
  qualifiedNode,
  env,
  ports,
  installedCli,
  environment = 'production',
  executeCommand: _executeCommand,
  signal,
  readyTimeoutMs = 60_000,
  lifetimeMs = 900_000,
  captureCsrAuthority = false,
}) {
  if (!['generated', 'hand-authored'].includes(row.kind))
    fail('Caller must supply the actual consumer kind');
  if (!['production', 'development'].includes(environment))
    fail('Unknown host phase');
  const initialAuthority = await readConformanceHostAuthority({
    row,
    manifest,
    environment: 'production',
  });
  const csrAuthority =
    environment === 'production' &&
    row.renderer !== 'react' &&
    captureCsrAuthority
      ? capturedEntryAuthority(
          await readConformanceHostAuthority({
            row,
            manifest,
            entryName: initialAuthority.csrIdentity.entryName,
          }),
        )
      : undefined;
  let resolveReadyAuthority;
  if (environment === 'development') {
    developmentOwner(initialAuthority.applicationRoot, row.kind);
    const metadataFile = path.join(
      initialAuthority.distDirectory,
      '.ultramodern-dev',
      'renderer-build.json',
    );
    if (
      typeof row.environments?.development?.metadataFile !== 'string' ||
      path.resolve(
        initialAuthority.consumerRoot,
        row.environments.development.metadataFile,
      ) !== metadataFile
    )
      fail('Supervisor must supply the fixed owning development metadata path');
    const initialCheckpoint = await statCheckpoint(metadataFile);
    const production = {
      ...initialAuthority,
      manifest,
      preserveFiles: initialAuthority.files.filter(
        value =>
          value.file ===
          path.resolve(
            initialAuthority.consumerRoot,
            initialAuthority.metadataFile,
          ),
      ),
    };
    resolveReadyAuthority = (baseUrl, { startedAt, signal: readinessSignal }) =>
      readDevelopmentHostAuthority({
        row,
        production,
        initialCheckpoint,
        startedAt,
        baseUrl,
        signal: readinessSignal,
      });
  }
  const handle = await startIdentityBoundHost({
    authority: initialAuthority,
    qualifiedNode,
    env,
    port: ports?.[environment],
    installedCli,
    logsDirectory: row.hostLogsDirectory,
    label: `${row.renderer}-${row.kind}-${environment}`,
    environment,
    resolveReadyAuthority,
    signal,
    readyTimeoutMs,
    lifetimeMs,
  });
  try {
    const authority = handle.authority;
    const factory =
      row.renderer === 'react' ? createReactHttpProbes : createNativeHttpProbes;
    const probes = factory({
      kind: row.kind,
      environment,
      identity: authority.identity,
      routePrefix: authority.routePrefix,
      pageRouteId: authority.pageRouteId,
      controlRouteId: authority.controlRouteId,
      headIncludes: authority.headIncludes,
      runId: `c2_${randomUUID().replaceAll('-', '')}`,
    });
    const host = {
      baseUrl: handle.baseUrl,
      metadataFile: authority.metadataFile,
      identity: handle.observedIdentity,
      csrIdentity: authority.csrIdentity,
      ...(csrAuthority
        ? {
            entryAuthorities: {
              [csrAuthority.identity.entryName]: csrAuthority,
            },
          }
        : {}),
      probes,
      authority: {
        routePrefix: authority.routePrefix,
        csrRoutePrefix: authority.csrRoutePrefix,
        pageRouteId: authority.pageRouteId,
        controlRouteId: authority.controlRouteId,
        ...(authority.itemRouteId
          ? { itemRouteId: authority.itemRouteId }
          : {}),
        serverDataModules: authority.serverDataModules,
        headIncludes: authority.headIncludes,
        cssAuthority: authority.cssAuthority,
      },
      ...(authority.nativeCompilerManifests
        ? {
            nativeCompilerManifests: authority.nativeCompilerManifests,
            nativeCompilerAuthority: authority.nativeCompilerAuthority,
          }
        : {}),
    };
    signal?.throwIfAborted();
    row.environments ??= {};
    row.environments[environment] = {
      ...row.environments[environment],
      ...host,
    };
    return {
      ...handle,
      host,
      get failure() {
        return handle.failure;
      },
    };
  } catch (cause) {
    const error =
      cause instanceof Error
        ? cause
        : new Error('Owned host setup failed', { cause });
    try {
      error.hostLog = await handle.stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Owned host setup and cleanup failed',
      );
    }
    throw error;
  }
}

function decodeMarkupText(text) {
  const entities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
  };
  return text.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu,
    (whole, entity) => {
      if (!entity.startsWith('#'))
        return entities[entity.toLowerCase()] ?? whole;
      const codePoint =
        entity[1].toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      if (
        !Number.isInteger(codePoint) ||
        codePoint <= 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      )
        fail('Invalid numeric entity in observed HTML');
      return String.fromCodePoint(codePoint);
    },
  );
}

// A bounded markup tokenizer for the authored starter's element assertions.
// Inert/raw-text content is excluded, and attribute quotes are consumed before
// locating a tag boundary. Script text cannot stand in for a rendered element.
function markupNodes(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > 8 * 1024 * 1024)
    fail('Starter HTML exceeds the observation budget');
  const voidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);
  const ignoredTags = new Set([
    'script',
    'style',
    'template',
    'noscript',
    'textarea',
    'title',
    'iframe',
    'xmp',
    'noembed',
    'noframes',
  ]);
  const nodes = [];
  const stack = [];
  let cursor = 0;
  while (cursor < html.length) {
    if (html[cursor] !== '<') {
      const end = html.indexOf('<', cursor);
      const text = decodeMarkupText(
        html.slice(cursor, end < 0 ? html.length : end),
      );
      for (const node of stack)
        if (node.attributes['data-testid'] === 'native-hmr-marker')
          node.text += text;
      cursor = end < 0 ? html.length : end;
      continue;
    }
    if (html.startsWith('<!--', cursor)) {
      const end = html.indexOf('-->', cursor + 4);
      if (end < 0) fail('Observed starter HTML has an unterminated comment');
      cursor = end + 3;
      continue;
    }
    let end = cursor + 1;
    let quote;
    for (; end < html.length; end++) {
      const character = html[end];
      if (quote) {
        if (character === quote) quote = undefined;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end === html.length)
      fail('Observed starter HTML has an unterminated tag');
    const tag = html.slice(cursor, end + 1);
    cursor = end + 1;
    if (/^<!doctype\b/iu.test(tag)) continue;
    const closing = /^<\/([a-z][\w:-]*)\s*>$/iu.exec(tag);
    if (closing) {
      if (stack.at(-1)?.name !== closing[1].toLowerCase())
        fail('Observed starter HTML has unmatched closing elements');
      stack.pop();
      continue;
    }
    const opening = /^<([a-z][\w:-]*)([\s\S]*?)\/?\s*>$/iu.exec(tag);
    if (!opening) fail('Observed starter HTML has an unsupported tag');
    const name = opening[1].toLowerCase();
    if (name === 'plaintext')
      fail('Plaintext HTML cannot qualify authored starter elements');
    if (ignoredTags.has(name)) {
      const closingPattern = new RegExp(`</${name}\\s*>`, 'giu');
      closingPattern.lastIndex = cursor;
      const finish = closingPattern.exec(html);
      if (!finish) fail('Observed starter HTML has unterminated inert content');
      cursor = finish.index + finish[0].length;
      continue;
    }
    const attributes = Object.create(null);
    let rest = opening[2].trim();
    while (rest) {
      const attribute =
        /^([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+)))?\s*/u.exec(
          rest,
        );
      if (!attribute || Object.hasOwn(attributes, attribute[1].toLowerCase()))
        fail('Observed starter HTML has malformed or repeated attributes');
      attributes[attribute[1].toLowerCase()] = decodeMarkupText(
        attribute[2] ?? attribute[3] ?? attribute[4] ?? '',
      );
      rest = rest.slice(attribute[0].length);
    }
    const node = { name, attributes, parent: stack.at(-1), text: '' };
    nodes.push(node);
    if (!voidTags.has(name) && !/\/\s*>$/u.test(tag)) stack.push(node);
    if (nodes.length > 4_096 || stack.length > 128)
      fail(
        'Observed starter HTML exceeds the element/depth observation budget',
      );
  }
  if (stack.length) fail('Observed starter HTML has unclosed elements');
  return nodes;
}

function observeStarterMarkup(html, identity) {
  const nodes = markupNodes(html);
  const route = one(
    nodes.filter(
      node =>
        node.name === 'section' &&
        node.attributes['data-testid'] === 'native-route',
    ),
    'Observed starter route section',
  );
  const unsupportedMarkerParents = new Set([
    'svg',
    'math',
    'select',
    'option',
    'optgroup',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'colgroup',
    'head',
  ]);
  const requireBodyContext = node => {
    let bodyAncestor = false;
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (unsupportedMarkerParents.has(parent.name))
        fail('Starter markers occur in an unsupported HTML parsing context');
      if (parent.name === 'body') bodyAncestor = true;
    }
    if (!bodyAncestor) fail('Starter markers are outside the document body');
  };
  requireBodyContext(route);
  if (
    route.attributes['data-renderer'] !== identity.renderer ||
    route.attributes['data-app-id'] !== identity.appId
  )
    fail(
      'Observed starter route renderer/appId differs from its owning identity',
    );
  const counter = one(
    nodes.filter(
      node =>
        node.name === 'section' &&
        node.attributes['data-testid'] === 'native-edited-component',
    ),
    'Observed starter Counter section',
  );
  const marker = one(
    nodes.filter(
      node =>
        node.name === 'span' &&
        node.attributes['data-testid'] === 'native-hmr-marker',
    ),
    'Observed starter Counter span',
  );
  requireBodyContext(counter);
  requireBodyContext(marker);
  const descendsFrom = (node, ancestor) => {
    for (let parent = node.parent; parent; parent = parent.parent)
      if (parent === ancestor) return true;
    return false;
  };
  if (
    !descendsFrom(counter, route) ||
    !descendsFrom(marker, counter) ||
    marker.text.trim() !== 'Counter before native edit'
  )
    fail(
      'Observed starter Counter is absent, outside its route, or has unexpected text',
    );
  return {
    route: {
      element: route.name,
      testId: route.attributes['data-testid'],
      renderer: route.attributes['data-renderer'],
      appId: route.attributes['data-app-id'],
    },
    counter: {
      element: counter.name,
      testId: counter.attributes['data-testid'],
    },
    marker: {
      element: marker.name,
      testId: marker.attributes['data-testid'],
      text: marker.text.trim(),
    },
    assertionCount: 7,
  };
}

/** Genuine untouched native starter SSR only; source preservation is caller-owned. */
export async function qualifyUntouchedNativeStarter({
  baseline,
  manifest,
  qualifiedNode,
  env,
  port,
  installedCli,
  logsDirectory,
  signal,
  readyTimeoutMs = 60_000,
  lifetimeMs = 900_000,
}) {
  if (!['solid', 'octane'].includes(baseline?.renderer))
    fail('Untouched starter qualification requires an actual native renderer');
  const applicationRoot = await fs.realpath(baseline.appRoot);
  const metadata = await readAuthority(applicationRoot, baseline.metadataFile);
  if (
    path.basename(metadata.file) !== 'renderer-build.json' ||
    path.basename(path.dirname(metadata.file)) === '.ultramodern-dev' ||
    !isDeepStrictEqual(metadata.value, manifest)
  )
    fail(
      'Untouched starter manifest differs from its actual production metadata',
    );
  await loadInstalledBuildManifest({
    applicationRoot,
    metadata: metadata.value,
    renderer: baseline.renderer,
    kind: 'generated',
  });
  const identity = manifest.identities?.[baseline.identity?.entryName];
  if (
    !identity ||
    identity.renderer !== baseline.renderer ||
    identity.buildId !== manifest.buildMarker
  )
    fail('Untouched starter has no matching built entry identity');
  const routes = await readAuthority(
    applicationRoot,
    path.join(path.dirname(metadata.file), 'route.json'),
  );
  if (!Array.isArray(routes.value.routes))
    fail('Untouched starter analyzed routes are absent');
  const route = one(
    routes.value.routes.filter(
      value =>
        !value.isApi &&
        value.isSSR === true &&
        value.entryName === identity.entryName,
    ),
    'Untouched starter actual SSR entry',
  );
  if (
    typeof route.urlPath !== 'string' ||
    !route.urlPath.startsWith('/') ||
    route.urlPath.includes('?') ||
    route.urlPath.includes('#')
  )
    fail('Untouched starter has no actual local SSR prefix');
  const authority = {
    applicationRoot,
    identity,
    routePrefix: route.urlPath,
    files: [metadata, routes].map(({ file, sha256 }) => ({ file, sha256 })),
  };
  const handle = await startIdentityBoundHost({
    authority,
    qualifiedNode,
    env,
    port,
    installedCli,
    logsDirectory,
    label: `untouched-${baseline.renderer}`,
    signal,
    readyTimeoutMs,
    lifetimeMs,
  });
  try {
    const observations = await probeHttp({
      baseUrl: handle.baseUrl,
      renderer: baseline.renderer,
      identity,
      timeoutMs: 30_000,
      probes: {
        cases: [
          {
            id: 'untouched-native-starter-ssr',
            dimension: 'ssr',
            path: `${route.urlPath.replace(/\/$/u, '')}/`,
            expect: {
              status: 200,
              bodyIncludes: [
                'native-route',
                'native-edited-component',
                'Counter before native edit',
              ],
            },
          },
        ],
      },
    });
    const fact = one(
      one(
        observations.filter(value => value.dimension === 'ssr'),
        'Untouched starter SSR observation',
      ).observations.cases,
      'Untouched starter observed response',
    );
    const markup = observeStarterMarkup(fact.body, fact.observedIdentity);
    for (const file of authority.files)
      if (digest(await fs.readFile(file.file)) !== file.sha256)
        fail('Untouched starter build authority changed while serving');
    signal?.throwIfAborted();
    const receipt = {
      schema: 'ultramodern-untouched-native-starter-ssr',
      version: 1,
      renderer: baseline.renderer,
      metadataFile: metadata.file,
      metadataSha256: metadata.sha256,
      analyzedRoutesFile: routes.file,
      analyzedRoutesSha256: routes.sha256,
      observedIdentity: fact.observedIdentity,
      markup,
      response: {
        status: fact.status,
        headers: fact.headers,
        bodySha256: digest(fact.body),
        assertionCount: fact.assertionCount,
      },
      assertionCount: fact.assertionCount + markup.assertionCount,
    };
    return {
      ...handle,
      receipt,
      get failure() {
        return handle.failure;
      },
    };
  } catch (cause) {
    const error =
      cause instanceof Error
        ? cause
        : new Error('Untouched starter SSR failed', { cause });
    try {
      error.hostLog = await handle.stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Untouched starter SSR and cleanup failed',
      );
    }
    throw error;
  }
}
