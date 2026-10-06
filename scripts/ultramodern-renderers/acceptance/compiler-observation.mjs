import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const receiptName = 'native-compiler-observation.json';
const observerSource = fileURLToPath(
  new URL(
    '../../../tests/ultramodern-renderers/conformance/fixtures/observe-native-compiler.ts',
    import.meta.url,
  ),
);

function fail(message) {
  throw new Error(`Native compiler observation: ${message}`);
}

function inside(root, value) {
  if (typeof value !== 'string' || !value) fail('missing consumer source path');
  const absolute = path.resolve(root, value);
  const relative = path.relative(root, absolute);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    fail('source must belong to the actual consumer');
  return absolute;
}

async function ordinaryFile(root, value) {
  const absolute = inside(root, value);
  const relative = path.relative(root, absolute);
  let current = root;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    if ((await fs.lstat(current)).isSymbolicLink())
      fail('source and receipt paths must not be symlinks');
  }
  if (
    !(await fs.lstat(absolute)).isFile() ||
    (await fs.realpath(absolute)) !== absolute
  )
    fail('source must be an ordinary consumer file');
  return absolute;
}

function sameNames(actual, expected, label) {
  if (
    !Array.isArray(actual) ||
    actual.some(name => typeof name !== 'string') ||
    new Set(actual).size !== actual.length ||
    !isDeepStrictEqual([...actual].sort(), [...expected].sort())
  )
    fail(`${label} does not match the actual authored entry names`);
}

async function validateCompiledStylesheets(
  value,
  environment,
  root,
  environmentDist,
  buildEnvironment,
  builtArtifacts,
) {
  const fields = (record, expected) =>
    record &&
    typeof record === 'object' &&
    !Array.isArray(record) &&
    isDeepStrictEqual(Object.keys(record).sort(), [...expected].sort());
  if (
    !fields(value, [
      'evidence',
      'compilationHash',
      'outputPath',
      'publicPath',
      'assets',
      'startupFiles',
      'sha256',
    ]) ||
    value.evidence !== 'stats.compilation.getAssets' ||
    value.compilationHash !== environment.compilationHash ||
    typeof value.outputPath !== 'string' ||
    !path.isAbsolute(value.outputPath) ||
    value.outputPath !== environmentDist ||
    typeof value.publicPath !== 'string' ||
    !Array.isArray(value.assets) ||
    !value.startupFiles ||
    typeof value.startupFiles !== 'object' ||
    Array.isArray(value.startupFiles) ||
    !/^[a-f\d]{64}$/u.test(value.sha256 ?? '')
  )
    fail('requires actual completed client stylesheet output evidence');
  const names = new Set();
  for (const asset of value.assets) {
    if (
      !fields(asset, ['file', 'sha256', 'size', 'source']) ||
      typeof asset.file !== 'string' ||
      !asset.file ||
      path.isAbsolute(asset.file) ||
      asset.file.includes('\\') ||
      asset.file.includes('\0') ||
      asset.file !== path.posix.normalize(asset.file) ||
      asset.file === '..' ||
      asset.file.startsWith('../') ||
      path.posix.extname(asset.file).toLowerCase() !== '.css' ||
      names.has(asset.file) ||
      !/^[a-f\d]{64}$/u.test(asset.sha256 ?? '') ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 0 ||
      !fields(asset.source, ['encoding', 'bytes']) ||
      typeof asset.source.bytes !== 'string' ||
      !['utf8', 'base64'].includes(asset.source.encoding)
    )
      fail('compiled stylesheet asset bytes are malformed');
    names.add(asset.file);
    const bytes = Buffer.from(asset.source.bytes, asset.source.encoding);
    if (
      (asset.source.encoding === 'base64' &&
        bytes.toString('base64') !== asset.source.bytes) ||
      (asset.source.encoding === 'utf8' &&
        bytes.toString('utf8') !== asset.source.bytes) ||
      sha256(bytes) !== asset.sha256 ||
      bytes.byteLength !== asset.size
    )
      fail('compiled stylesheet source bytes disagree with their digest');
    if (buildEnvironment === 'production') {
      const absolute = await ordinaryFile(
        root,
        path.join(value.outputPath, asset.file),
      );
      const outputBytes = await fs.readFile(absolute);
      if (!outputBytes.equals(bytes))
        fail(
          'production stylesheet output bytes drifted from actual compiler assets',
        );
      builtArtifacts.push({ absolute, sha256: asset.sha256, size: asset.size });
    }
  }
  sameNames(
    Object.keys(value.startupFiles),
    environment.compiledEntryNames,
    'stylesheet startup entries',
  );
  for (const name of environment.compiledEntryNames) {
    const files = value.startupFiles[name];
    const expected = environment.compiledEntryFiles[name].filter(
      file => path.posix.extname(file).toLowerCase() === '.css',
    );
    if (
      !Array.isArray(files) ||
      new Set(files).size !== files.length ||
      !isDeepStrictEqual(files, expected) ||
      files.some(file => !names.has(file))
    )
      fail(
        'startup stylesheet files disagree with the actual emitted CSS closure',
      );
  }
  const {
    evidence,
    compilationHash,
    outputPath,
    publicPath,
    assets,
    startupFiles,
  } = value;
  if (
    sha256(
      JSON.stringify({
        evidence,
        compilationHash,
        outputPath,
        publicPath,
        assets,
        startupFiles,
      }),
    ) !== value.sha256
  )
    fail('compiled stylesheet closure digest changed');
  return value;
}

function configuredPlugins(value, evidence, renderer, nativeOwnership = true) {
  if (
    !value ||
    value.evidence !== evidence ||
    value.appliedOwnership !== 'unavailable-public-api' ||
    !Array.isArray(value.plugins) ||
    !Array.isArray(value.names)
  )
    fail('configured plugin evidence is malformed or claims applied ownership');
  for (const plugin of value.plugins) {
    if (
      !plugin ||
      typeof plugin.name !== 'string' ||
      !plugin.name ||
      !Object.hasOwn(plugin, 'configuredClaim')
    )
      fail('configured plugin evidence is malformed');
    if (
      nativeOwnership &&
      [
        'rsbuild:react',
        'rsbuild:svgr',
        'builder-plugin-adapter-modern-ssr',
      ].includes(plugin.name)
    )
      fail(
        'configured plugins include a forbidden React compiler or SVG owner',
      );
    const claim = plugin.configuredClaim;
    if (
      claim !== null &&
      (!claim ||
        claim.renderer !== renderer ||
        claim.transform !== 'native' ||
        claim.refresh !== 'native' ||
        claim.svg !== 'url' ||
        !Array.isArray(claim.sourceExtensions) ||
        !claim.sourceExtensions.length ||
        claim.sourceExtensions.some(
          value => typeof value !== 'string' || !value,
        ))
    )
      fail('configured compiler claim has the wrong renderer authority');
  }
  const claimCount = value.plugins.filter(
    plugin => plugin.configuredClaim !== null,
  ).length;
  if (
    (nativeOwnership &&
      evidence === 'api.getNormalizedConfig().plugins' &&
      claimCount !== 1) ||
    claimCount > 1
  )
    fail('requires exactly one configured native compiler owner');
  if (
    !isDeepStrictEqual(
      value.names,
      value.plugins.map(plugin => plugin.name),
    )
  )
    fail('configured plugin names disagree with their observations');
}

async function validateCompiledModuleGraph(
  graph,
  environment,
  consumerRoot,
  sources,
) {
  const records = [];
  const fields = (value, expected) =>
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
  const visit = async current => {
    if (
      !fields(current, [
        'evidence',
        'name',
        'compilationHash',
        'modules',
        'children',
        'sha256',
      ]) ||
      current.evidence !== 'stats.compilation.modules' ||
      (current.name !== null &&
        (typeof current.name !== 'string' || !current.name)) ||
      (current.compilationHash !== null &&
        (typeof current.compilationHash !== 'string' ||
          !current.compilationHash)) ||
      !Array.isArray(current.modules) ||
      !Array.isArray(current.children) ||
      !/^[a-f\d]{64}$/u.test(current.sha256 ?? '')
    )
      fail(
        'compiled module graph is malformed or lacks actual Stats provenance',
      );
    const { sha256: digest, ...value } = current;
    if (sha256(JSON.stringify(value)) !== digest)
      fail('compiled module graph digest does not match its records');
    const module = async record => {
      if (
        !fields(record, ['identifier', 'resource', 'source', 'modules']) ||
        typeof record.identifier !== 'string' ||
        !record.identifier ||
        (record.resource !== null &&
          (typeof record.resource !== 'string' || !record.resource)) ||
        !Array.isArray(record.modules)
      )
        fail('compiled module resource record is malformed');
      if (record.resource === null || /^data:[^,]*,/u.test(record.resource)) {
        if (record.source !== null)
          fail(
            'resource-less compiler module cannot claim physical source bytes',
          );
      } else {
        const source = record.source;
        const match =
          /^((?:\0[\s\S]|[^?#\0])*)(?:\?(?:\0[\s\S]|[^#\0])*)?(?:#[\s\S]*)?$/u.exec(
            record.resource,
          );
        const requested = match?.[1]?.replace(/\0([\s\S])/gu, '$1');
        if (
          !fields(source, ['path', 'sha256', 'size']) ||
          typeof source.path !== 'string' ||
          !path.isAbsolute(source.path) ||
          !requested ||
          !path.isAbsolute(requested) ||
          requested.includes('\0') ||
          !/^[a-f\d]{64}$/u.test(source.sha256 ?? '') ||
          !Number.isSafeInteger(source.size) ||
          source.size < 0
        )
          fail('compiled module source pin is malformed');
        const absolute = await ordinaryFile(consumerRoot, source.path);
        if (
          absolute !== source.path ||
          (await fs.realpath(requested)) !== absolute
        )
          fail(
            'compiled module resource differs from its canonical source pin',
          );
        const bytes = await fs.readFile(absolute);
        if (sha256(bytes) !== source.sha256 || bytes.byteLength !== source.size)
          fail('compiled module source bytes drifted after compilation');
        const previous = sources.get(absolute);
        if (
          previous &&
          (previous.sha256 !== source.sha256 || previous.size !== source.size)
        )
          fail('compiled module resources disagree about their source bytes');
        sources.set(absolute, {
          absolute,
          sha256: source.sha256,
          size: source.size,
        });
      }
      records.push(record);
      for (const nested of record.modules) await module(nested);
    };
    for (const record of current.modules) await module(record);
    for (const child of current.children) await visit(child);
  };
  await visit(graph);
  if (
    graph.name !== environment.name ||
    graph.compilationHash !== environment.compilationHash ||
    !graph.modules.length
  )
    fail(
      'compiled module graph belongs to a different or empty actual compilation',
    );
  return records;
}

function developmentCompilation(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !isDeepStrictEqual(Object.keys(value).sort(), [
      'compilationHashes',
      'generation',
      'sourceInputDigest',
    ]) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    !/^[a-f\d]{64}$/u.test(value.sourceInputDigest ?? '') ||
    !value.compilationHashes ||
    typeof value.compilationHashes !== 'object' ||
    Array.isArray(value.compilationHashes)
  )
    fail('development compilation record is malformed');
  sameNames(
    Object.keys(value.compilationHashes),
    ['client', 'server'],
    'development compiler names',
  );
  if (
    Object.values(value.compilationHashes).some(
      hash => typeof hash !== 'string' || !/^[a-f\d]{1,64}$/u.test(hash),
    )
  )
    fail('development compiler hashes are malformed');
}

function observedSolidModuleFiles(environment, metadata, expectedEntryNames) {
  if (!Array.isArray(environment.nativeModuleManifests))
    fail('development compilation omits native memory manifest observations');
  sameNames(
    environment.nativeModuleManifests.map(record => record?.file),
    expectedEntryNames.map(
      name => `solid-module-manifest.${encodeURIComponent(name)}.json`,
    ),
    'development native module manifests',
  );
  const moduleFiles = new Set();
  for (const name of expectedEntryNames) {
    const record = environment.nativeModuleManifests.find(
      record =>
        record.file ===
        `solid-module-manifest.${encodeURIComponent(name)}.json`,
    );
    if (
      typeof record.source !== 'string' ||
      !/^[a-f\d]{64}$/u.test(record.sha256 ?? '') ||
      !Number.isSafeInteger(record.size) ||
      record.size < 0 ||
      sha256(record.source) !== record.sha256 ||
      Buffer.byteLength(record.source) !== record.size
    )
      fail('development native memory manifest bytes are unauthenticated');
    const manifest = JSON.parse(record.source);
    if (
      metadata.profile.compiler?.version !== '2.0.0-rc.13' ||
      manifest.schemaVersion !== 1 ||
      manifest.renderer !== 'solid' ||
      manifest.compilerVersion !== metadata.profile.compiler.version ||
      !isDeepStrictEqual(
        manifest.rendererIdentity,
        metadata.identities[name],
      ) ||
      !manifest.modules ||
      typeof manifest.modules !== 'object' ||
      Array.isArray(manifest.modules)
    )
      fail(
        'development native manifests lack matching Solid hydration ownership',
      );
    for (const [key, value] of Object.entries(manifest.modules)) {
      if (key === '_base') continue;
      if (
        !value ||
        typeof value.file !== 'string' ||
        !value.file ||
        path.isAbsolute(value.file) ||
        value.file.includes('\\') ||
        value.file !== path.posix.normalize(value.file) ||
        value.file === '..' ||
        value.file.startsWith('../')
      )
        fail('development native hydration module asset is malformed');
      moduleFiles.add(value.file);
    }
  }
  return moduleFiles;
}

/**
 * Authenticate a receipt from the actual native build or completed dev wave.
 * Development callers must supply the installed public reader's validated manifest.
 */
async function readCompilerObservation({
  applicationRoot,
  consumerRoot = applicationRoot,
  distDirectory,
  renderer,
  expectedEntryNames,
  expectedRsbuildVersion = '2.2.11',
  environment: buildEnvironment = 'production',
  expectedDevelopmentManifest,
  nativeOwnership = true,
}) {
  if (
    !['production', 'development'].includes(buildEnvironment) ||
    !(
      nativeOwnership ? ['solid', 'octane'] : ['react', 'solid', 'octane']
    ).includes(renderer) ||
    !Array.isArray(expectedEntryNames) ||
    !expectedEntryNames.length ||
    new Set(expectedEntryNames).size !== expectedEntryNames.length ||
    expectedEntryNames.some(
      name => typeof name !== 'string' || !/^[a-z\d_-]+$/iu.test(name),
    )
  )
    fail('requires a native renderer and exact authored entry names');
  const root = await fs.realpath(applicationRoot);
  const moduleRoot = await fs.realpath(consumerRoot);
  const applicationRelation = path.relative(moduleRoot, root);
  if (
    applicationRelation === '..' ||
    applicationRelation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(applicationRelation)
  )
    fail('application must belong to its exact module resource consumer root');
  const dist = inside(root, distDirectory);
  if (
    (await fs.realpath(dist)) !== dist ||
    !(await fs.lstat(dist)).isDirectory()
  )
    fail('output directory is not the actual consumer output');
  const receiptPath = await ordinaryFile(
    root,
    path.join(
      dist,
      ...(buildEnvironment === 'development' ? ['.ultramodern-dev'] : []),
      receiptName,
    ),
  );
  const sidecarPath = await ordinaryFile(root, `${receiptPath}.sha256`);
  const bytes = await fs.readFile(receiptPath);
  const sidecarBytes = await fs.readFile(sidecarPath);
  const receiptSha256 = sha256(bytes);
  if (sidecarBytes.toString('utf8') !== `${receiptSha256}\n`)
    fail('receipt byte digest does not match its sidecar');
  const observation = JSON.parse(bytes);
  if (
    observation.schema !== 'ultramodern-native-compiler-observation' ||
    observation.version !== 1 ||
    observation.observer?.event !==
      (buildEnvironment === 'development'
        ? 'onDevCompileDone'
        : 'onAfterBuild') ||
    observation.observer.order !== 'post' ||
    observation.observer.rsbuildVersion !== expectedRsbuildVersion ||
    observation.rootPath !== root ||
    observation.distPath !== dist
  )
    fail(
      'receipt is not from the supported successful compilation of this consumer',
    );
  let developmentManifest;
  let developmentMetadataFile;
  if (buildEnvironment === 'development') {
    const record = observation.development;
    developmentMetadataFile = await ordinaryFile(
      root,
      path.join(dist, '.ultramodern-dev', 'renderer-build.json'),
    );
    const metadataBytes = await fs.readFile(developmentMetadataFile);
    developmentManifest = JSON.parse(metadataBytes);
    if (
      !record ||
      !isDeepStrictEqual(Object.keys(record).sort(), [
        'devCompilation',
        'metadataFile',
        'metadataSha256',
      ]) ||
      record.metadataFile !== developmentMetadataFile ||
      record.metadataSha256 !== sha256(metadataBytes) ||
      !expectedDevelopmentManifest ||
      !isDeepStrictEqual(developmentManifest, expectedDevelopmentManifest) ||
      developmentManifest.schema !== 'ultramodern-renderer-build' ||
      developmentManifest.version !== 1 ||
      developmentManifest.profile?.renderer !== renderer ||
      developmentManifest.cacheAllowed !== false ||
      developmentManifest.promotable !== false
    )
      fail(
        'development receipt is not bound to the actual public-validated manifest',
      );
    developmentCompilation(developmentManifest.devCompilation);
    developmentCompilation(record.devCompilation);
    if (
      !isDeepStrictEqual(
        record.devCompilation,
        developmentManifest.devCompilation,
      )
    )
      fail('development receipt belongs to a different compilation generation');
    sameNames(
      Object.keys(developmentManifest.identities ?? {}),
      expectedEntryNames,
      'development renderer manifest entries',
    );
  } else if (Object.hasOwn(observation, 'development')) {
    fail('production receipt cannot claim development compilation authority');
  }
  configuredPlugins(
    observation.configuredPlugins,
    'api.getNormalizedConfig().plugins',
    renderer,
    nativeOwnership,
  );
  if (
    !Array.isArray(observation.environments) ||
    observation.environments.length !== 2
  )
    fail('requires exactly the actual client and server compilations');
  sameNames(
    observation.environments.map(environment => environment?.name),
    ['client', 'server'],
    'environments',
  );
  if (
    !Array.isArray(observation.sourceInventory) ||
    !observation.sourceInventory.length
  )
    fail('requires the observed source inventory');
  const inventory = new Map();
  for (const record of observation.sourceInventory) {
    if (
      !record ||
      typeof record.path !== 'string' ||
      path.isAbsolute(record.path) ||
      record.path.includes('\\') ||
      record.path !== path.posix.normalize(record.path) ||
      !/^[a-f\d]{64}$/u.test(record.sha256 ?? '') ||
      !Number.isSafeInteger(record.size) ||
      record.size < 0 ||
      !Array.isArray(record.roles) ||
      !record.roles.length ||
      record.roles.some(role => typeof role !== 'string' || !role) ||
      new Set(record.roles).size !== record.roles.length
    )
      fail('observed source inventory is malformed');
    const absolute = await ordinaryFile(root, record.path);
    if (inventory.has(absolute))
      fail('observed source inventory contains duplicate files');
    const sourceBytes = await fs.readFile(absolute);
    if (
      sha256(sourceBytes) !== record.sha256 ||
      sourceBytes.byteLength !== record.size
    )
      fail('observed source bytes drifted after compilation');
    inventory.set(absolute, { ...record, absolute });
  }
  const requireSource = async (value, role) => {
    const absolute = await ordinaryFile(root, value);
    if (!inventory.get(absolute)?.roles.includes(role))
      fail(`source inventory omits the actual ${role} root`);
    return absolute;
  };
  const trustedObserverSha256 = sha256(await fs.readFile(observerSource));
  const fixtureObserver = await requireSource(
    'observe-native-compiler.ts',
    'fixture-observer',
  );
  if (inventory.get(fixtureObserver).sha256 !== trustedObserverSha256)
    fail('fixture observer differs from the authenticated acceptance source');
  await requireSource('modern.config.ts', 'fixture-config');
  await requireSource(observation.observer.sourceFile, 'executing-observer');
  if (observation.configFile !== null)
    await requireSource(observation.configFile, 'sdk-config');
  if (developmentMetadataFile) {
    await requireSource(developmentMetadataFile, 'development-manifest');
    if (
      inventory.get(developmentMetadataFile).sha256 !==
      observation.development.metadataSha256
    )
      fail(
        'development manifest source pin disagrees with its canonical byte digest',
      );
  }
  if (
    !Array.isArray(observation.configFileDependencies) ||
    new Set(observation.configFileDependencies).size !==
      observation.configFileDependencies.length
  )
    fail('SDK configuration dependency inventory is malformed');
  for (const file of observation.configFileDependencies)
    await requireSource(file, 'sdk-config-dependency');
  const nativeTypeEntries = { browser: [], server: [] };
  const compiledModuleResources = { browser: [], server: [] };
  const moduleSources = new Map();
  const auxiliaryCompiledEntries = [];
  const builtArtifacts = [];
  let clientStylesheets;
  for (const environment of observation.environments) {
    const role = environment.name === 'client' ? 'browser' : 'server';
    if (
      environment.target !== (role === 'browser' ? 'web' : 'node') ||
      environment.mode !== buildEnvironment ||
      environment.hasErrors !== false ||
      environment.errorCount !== 0 ||
      typeof environment.compilationHash !== 'string' ||
      !environment.compilationHash
    )
      fail(
        `requires successful completed ${buildEnvironment} client/web and server/node stats`,
      );
    if (
      developmentManifest &&
      developmentManifest.devCompilation.compilationHashes[environment.name] !==
        environment.compilationHash
    )
      fail(
        'observed development stats differ from the committed compiler hashes',
      );
    let observedModuleFiles;
    if (developmentManifest && nativeOwnership) {
      if (renderer === 'solid' && role === 'browser')
        observedModuleFiles = observedSolidModuleFiles(
          environment,
          developmentManifest,
          expectedEntryNames,
        );
      else if (!isDeepStrictEqual(environment.nativeModuleManifests, []))
        fail(
          'development memory manifests belong to an unadmitted compiler role',
        );
    } else if (
      !developmentManifest &&
      Object.hasOwn(environment, 'nativeModuleManifests')
    ) {
      fail('production receipt cannot claim development memory assets');
    }
    const environmentDist = inside(root, environment.distPath);
    if (
      environmentDist !== dist &&
      !environmentDist.startsWith(`${dist}${path.sep}`)
    )
      fail('compiled environment output does not belong to this build');
    configuredPlugins(
      environment.configuredPlugins,
      'environment.config.plugins',
      renderer,
      nativeOwnership,
    );
    compiledModuleResources[role] = await validateCompiledModuleGraph(
      environment.compiledModuleGraph,
      environment,
      moduleRoot,
      moduleSources,
    );
    for (const label of ['entry', 'configSourceEntry']) {
      if (
        !environment[label] ||
        typeof environment[label] !== 'object' ||
        Array.isArray(environment[label])
      )
        fail('missing actual final source entry map');
      sameNames(Object.keys(environment[label]), expectedEntryNames, label);
    }
    if (
      !Array.isArray(environment.compiledEntryNames) ||
      new Set(environment.compiledEntryNames).size !==
        environment.compiledEntryNames.length ||
      environment.compiledEntryNames.some(
        name => typeof name !== 'string' || !name,
      ) ||
      expectedEntryNames.some(
        name => !environment.compiledEntryNames.includes(name),
      )
    )
      fail('compiled entrypoints omit or duplicate authored entries');
    sameNames(
      Object.keys(environment.compiledEntryFiles ?? {}),
      environment.compiledEntryNames,
      'compiled entry file inventory',
    );
    for (const files of Object.values(environment.compiledEntryFiles))
      if (
        !Array.isArray(files) ||
        !files.length ||
        new Set(files).size !== files.length ||
        files.some(
          file =>
            typeof file !== 'string' ||
            !file ||
            path.isAbsolute(file) ||
            file.includes('\\') ||
            file !== path.posix.normalize(file) ||
            file === '..' ||
            file.startsWith('../'),
        )
      )
        fail('compiled entry file inventory is malformed');
    if (role === 'browser')
      clientStylesheets = await validateCompiledStylesheets(
        environment.compiledStylesheets,
        environment,
        root,
        environmentDist,
        buildEnvironment,
        builtArtifacts,
      );
    else if (Object.hasOwn(environment, 'compiledStylesheets'))
      fail('stylesheet closure belongs to the client compiler role');
    const extra = environment.compiledEntryNames.filter(
      name => !expectedEntryNames.includes(name),
    );
    if (extra.length && nativeOwnership) {
      if (renderer !== 'solid' || role !== 'browser')
        fail('unadmitted auxiliary compiled entrypoints');
      let moduleFiles = observedModuleFiles;
      if (!developmentManifest) {
        const metadataFile = await ordinaryFile(
          root,
          path.join(dist, 'renderer-build.json'),
        );
        const metadataBytes = await fs.readFile(metadataFile);
        const metadata = JSON.parse(metadataBytes);
        if (
          metadata.schema !== 'ultramodern-renderer-build' ||
          metadata.version !== 1 ||
          metadata.profile?.renderer !== 'solid' ||
          metadata.profile.compiler?.version !== '2.0.0-rc.13'
        )
          fail(
            'auxiliary entries lack the actual admitted Solid build manifest',
          );
        sameNames(
          Object.keys(metadata.identities ?? {}),
          expectedEntryNames,
          'saved renderer manifest entries',
        );
        builtArtifacts.push({
          absolute: metadataFile,
          sha256: sha256(metadataBytes),
          size: metadataBytes.byteLength,
        });
        moduleFiles = new Set();
        for (const name of expectedEntryNames) {
          const manifestFile = await ordinaryFile(
            root,
            path.join(
              environmentDist,
              `solid-module-manifest.${encodeURIComponent(name)}.json`,
            ),
          );
          const manifestBytes = await fs.readFile(manifestFile);
          const manifest = JSON.parse(manifestBytes);
          if (
            manifest.schemaVersion !== 1 ||
            manifest.renderer !== 'solid' ||
            manifest.compilerVersion !== metadata.profile.compiler.version ||
            !isDeepStrictEqual(
              manifest.rendererIdentity,
              metadata.identities[name],
            ) ||
            !manifest.modules ||
            typeof manifest.modules !== 'object' ||
            Array.isArray(manifest.modules)
          )
            fail(
              'auxiliary entries lack matching native Solid hydration ownership',
            );
          for (const [key, value] of Object.entries(manifest.modules)) {
            if (key === '_base') continue;
            if (
              !value ||
              typeof value.file !== 'string' ||
              !value.file ||
              path.isAbsolute(value.file) ||
              value.file.includes('\\') ||
              value.file !== path.posix.normalize(value.file) ||
              value.file === '..' ||
              value.file.startsWith('../')
            )
              fail('native Solid hydration module asset is malformed');
            const file = await ordinaryFile(
              root,
              path.join(environmentDist, value.file),
            );
            const bytes = await fs.readFile(file);
            moduleFiles.add(value.file);
            builtArtifacts.push({
              absolute: file,
              sha256: sha256(bytes),
              size: bytes.byteLength,
            });
          }
          builtArtifacts.push({
            absolute: manifestFile,
            sha256: sha256(manifestBytes),
            size: manifestBytes.byteLength,
          });
        }
      }
      for (const name of extra) {
        const nativeFiles = environment.compiledEntryFiles[name].filter(file =>
          moduleFiles.has(file),
        );
        if (nativeFiles.length !== 1)
          fail(
            'auxiliary compiled entry lacks exact native hydration manifest asset ownership',
          );
        auxiliaryCompiledEntries.push({
          environment: environment.name,
          name,
          files: [...environment.compiledEntryFiles[name]],
          nativeModuleFile: nativeFiles[0],
        });
      }
    }
    for (const name of expectedEntryNames) {
      const maps = [];
      for (const label of ['entry', 'configSourceEntry']) {
        const roots = environment[label][name];
        if (
          !Array.isArray(roots) ||
          !roots.length ||
          new Set(roots).size !== roots.length
        )
          fail('final entry imports must be nonempty unique file roots');
        const actual = [];
        for (const rootFile of roots)
          actual.push(
            await requireSource(
              rootFile,
              `environment:${environment.name}:${label === 'entry' ? 'entry' : 'config-source-entry'}`,
            ),
          );
        maps.push(actual);
      }
      if (!isDeepStrictEqual(maps[0], maps[1]))
        fail('actual entry and final config source entry imports disagree');
      for (const source of maps[0])
        if (
          !compiledModuleResources[role].some(
            module => module.source?.path === source,
          )
        )
          fail('compiled module graph omits an actual final entry source');
      if (!nativeOwnership) continue;
      const generated = maps[0].filter(
        file =>
          path.basename(file) ===
          (role === 'browser' ? 'index.ts' : 'index.server.ts'),
      );
      if (generated.length !== 1)
        fail(
          `entry ${name} does not have one actual generated ${role} type root`,
        );
      if (nativeTypeEntries[role].includes(generated[0]))
        fail('actual entries reuse the same generated type root');
      if (developmentManifest && role === 'server')
        await requireSource(
          path.join(path.dirname(generated[0]), 'routes.server.ts'),
          'environment:server:route-ir',
        );
      nativeTypeEntries[role].push(generated[0]);
    }
  }
  const receipt = {
    receiptPath,
    receiptSha256,
    sidecarPath,
    sidecarSha256: sha256(sidecarBytes),
    applicationRoot: root,
    consumerRoot: moduleRoot,
    distDirectory: dist,
    renderer,
    environment: buildEnvironment,
    expectedEntryNames: [...expectedEntryNames],
    observation,
    nativeTypeEntries,
    auxiliaryCompiledEntries,
    builtArtifacts,
    sourceInventory: [...inventory.values()],
    compiledModuleResources,
    moduleSourceInventory: [...moduleSources.values()],
    clientStylesheets,
    clientModuleGraph: observation.environments.find(
      environment => environment.name === 'client',
    ).compiledModuleGraph,
  };
  await assertNativeCompilerObservationUnchanged(receipt);
  return receipt;
}

/** Keep native entry/type/artifact qualification on its original strict path. */
export function readNativeCompilerObservation(options) {
  return readCompilerObservation({ ...options, nativeOwnership: true });
}

/** Authenticate finalized client resources without asserting native generated roots. */
export function readCompiledClientModuleGraph(options) {
  return readCompilerObservation({ ...options, nativeOwnership: false });
}

/** Compare authored strict programs to roots from the completed compiler receipt. */
export async function assertNativeTypeProgramBindings(receipt, programs) {
  const programPaths = new Set();
  for (const role of ['browser', 'server']) {
    const item = programs[role];
    if (!item || !(await fs.lstat(item.path)).isFile())
      fail(`missing ${role} type program`);
    const programPath = await ordinaryFile(receipt.applicationRoot, item.path);
    if (programPaths.has(programPath))
      fail('browser and server type programs must be separate actual files');
    programPaths.add(programPath);
    const program = item.program;
    if (!isDeepStrictEqual(JSON.parse(await fs.readFile(programPath)), program))
      fail('type program differs from its actual file bytes');
    const expectedFiles = [...receipt.nativeTypeEntries[role]];
    if (role === 'server')
      expectedFiles.unshift(
        path.join(receipt.applicationRoot, 'modern.config.ts'),
      );
    if (
      !program ||
      !Array.isArray(program.files) ||
      new Set(program.files).size !== program.files.length ||
      !isDeepStrictEqual(
        program.files
          .map(file => path.resolve(path.dirname(programPath), file))
          .sort(),
        expectedFiles.sort(),
      ) ||
      !isDeepStrictEqual(
        program.compilerOptions?.types,
        role === 'browser' ? [] : ['node'],
      ) ||
      program.compilerOptions.strict !== true ||
      program.compilerOptions.noEmit !== true ||
      program.compilerOptions.noCheck !== false ||
      program.compilerOptions.skipLibCheck !== false ||
      !isDeepStrictEqual(
        program.include,
        role === 'browser' ? ['src/**/*.tsx', 'src/**/*.tsrx'] : ['src'],
      ) ||
      !isDeepStrictEqual(program.exclude, [])
    )
      fail(
        'requires strict browser types: [] and Node-host types: [node] programs bound to actual compiled roots',
      );
  }
}

/** Reject receipt or observed input drift during the subsequent strict checks. */
export async function assertNativeCompilerObservationUnchanged(receipt) {
  if (
    sha256(
      await fs.readFile(
        await ordinaryFile(receipt.applicationRoot, receipt.receiptPath),
      ),
    ) !== receipt.receiptSha256 ||
    sha256(
      await fs.readFile(
        await ordinaryFile(receipt.applicationRoot, receipt.sidecarPath),
      ),
    ) !== receipt.sidecarSha256
  )
    fail('receipt drifted during type checking');
  for (const source of [
    ...receipt.sourceInventory,
    ...receipt.builtArtifacts,
  ]) {
    const file = await ordinaryFile(receipt.applicationRoot, source.absolute);
    const bytes = await fs.readFile(file);
    if (sha256(bytes) !== source.sha256 || bytes.byteLength !== source.size)
      fail('observed source drifted during type checking');
  }
  for (const source of receipt.moduleSourceInventory) {
    const file = await ordinaryFile(receipt.consumerRoot, source.absolute);
    const bytes = await fs.readFile(file);
    if (sha256(bytes) !== source.sha256 || bytes.byteLength !== source.size)
      fail('compiled module source drifted during subsequent checks');
  }
}
