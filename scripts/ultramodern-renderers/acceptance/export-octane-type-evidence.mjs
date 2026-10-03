import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAdmissionPackages } from '../../../tests/ultramodern-renderers/octane-admission/native-artifact.mjs';

const strictFlags = [
  'strict',
  'isolatedModules',
  'verbatimModuleSyntax',
  'exactOptionalPropertyTypes',
  'noUncheckedIndexedAccess',
  'noPropertyAccessFromIndexSignature',
  'noImplicitOverride',
  'noFallthroughCasesInSwitch',
  'noImplicitReturns',
];
const passedChecks = [
  'passed',
  'strictTypeClosure',
  'canonicalGeneratedCompilerFlags',
  'exactOptionalPropertyTypes',
  'noUncheckedIndexedAccess',
  'noPropertyAccessFromIndexSignature',
  'isolatedRouterTypes',
  'nativeFormatting',
  'concreteDeclarations',
  'negativeAuthoredDiagnostics',
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const within = (directory, file) => {
  const relative = path.relative(directory, file);
  return (
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  );
};

function checkedBytes(fact, label) {
  assert.ok(
    fact && path.isAbsolute(fact.realpath ?? ''),
    `${label}: absolute realpath required`,
  );
  assert.equal(
    fs.realpathSync(fact.realpath),
    fact.realpath,
    `${label}: canonical realpath required`,
  );
  assert.ok(
    fs.lstatSync(fact.realpath).isFile(),
    `${label}: regular file required`,
  );
  const bytes = fs.readFileSync(fact.realpath);
  assert.equal(bytes.length, fact.size, `${label}: checked size changed`);
  assert.equal(sha256(bytes), fact.sha256, `${label}: checked bytes changed`);
  return bytes;
}

/** Validate the owning probe's actual closure before any output can be written. */
export function validateOctaneToolingReceipt(receipt) {
  for (const check of passedChecks)
    assert.equal(
      receipt?.[check],
      true,
      `Successful tooling check required: ${check}`,
    );
  assert.equal(
    receipt.reactRuntimeInstalled,
    false,
    'React runtime is outside the native boundary',
  );
  const checker = receipt.nativeChecker;
  assert.equal(
    checker?.compilerVersion,
    '7.0.2',
    'Stable TypeScript 7.0.2 required',
  );
  const program = checker.program;
  assert.ok(program, 'Actual checked program facts are required');
  assert.equal(
    program.compilerVersion,
    '7.0.2',
    'Checked program must use stable TypeScript 7.0.2',
  );
  assert.deepEqual(
    program.diagnostics,
    [],
    'Checked program diagnostics must be empty',
  );
  const options = program.config?.compilerOptions;
  assert.ok(options, 'Actual checked compiler options are required');
  for (const flag of strictFlags)
    assert.equal(
      options[flag],
      true,
      `Required checked compiler option: ${flag}`,
    );
  assert.equal(
    options.skipLibCheck,
    false,
    'Declaration checking must remain enabled',
  );
  assert.notEqual(options.skipDefaultLibCheck, true);
  assert.notEqual(options.noCheck, true);
  assert.deepEqual(
    options.types,
    [],
    'Automatic ambient discovery must remain disabled',
  );
  assert.ok(
    Array.isArray(program.files) && program.files.length > 0,
    'Actual checked file closure is required',
  );
  const files = new Map();
  for (const fact of program.files) {
    assert.ok(
      !files.has(fact.realpath),
      'Checked file closure contains duplicate paths',
    );
    files.set(fact.realpath, checkedBytes(fact, 'Checked program file'));
  }
  const paths = [...files.keys()];
  assert.deepEqual(
    paths,
    [...paths].sort(),
    'Checked file closure must retain canonical ordering',
  );
  assert.ok(
    Array.isArray(program.config.files) && program.config.files.length > 0,
    'Actual explicit checked files are required',
  );
  for (const file of program.config.files) {
    assert.ok(path.isAbsolute(file), 'Explicit checked file must be absolute');
    assert.ok(
      files.has(fs.realpathSync(file)),
      'Explicit checked file is missing from the program',
    );
  }

  const interop = receipt.nativeTypeInterop;
  assert.equal(
    interop?.schemaVersion,
    1,
    'Maintained native type interop evidence is required',
  );
  assert.equal(interop.blanketReactTypeException, false);
  assert.equal(interop.nonNativeRuntime, false);
  assert.equal(interop.skipLibCheck, false);
  for (const field of [
    'types',
    'foreignRendererTypes',
    'foreignRendererAugmentations',
  ])
    assert.deepEqual(
      interop[field],
      [],
      `Native interop ${field} must be empty`,
    );
  assert.equal(
    sha256(Buffer.from(`${JSON.stringify(paths)}\n`)),
    interop.canonicalTypeProgramSha256,
    'Checked file closure digest differs',
  );
  assert.ok(
    Array.isArray(interop.incomingGraph),
    'Actual checked incoming graph is required',
  );
  const graph = interop.incomingGraph;
  assert.deepEqual(
    graph.map(([file]) => file),
    [...paths].sort((left, right) => left.localeCompare(right)),
    'Incoming graph must retain the complete checked file closure',
  );
  assert.equal(
    sha256(Buffer.from(JSON.stringify(graph))),
    interop.canonicalIncomingGraphSha256,
    'Checked incoming graph digest differs',
  );
  for (const [target, incoming] of graph) {
    assert.ok(Array.isArray(incoming), 'Incoming graph edges must be arrays');
    for (const edge of incoming) {
      assert.equal(
        edge.to,
        target,
        'Incoming edge target differs from its graph key',
      );
      assert.ok(
        files.has(edge.from) && files.has(edge.to),
        'Incoming edge must stay in the checked closure',
      );
      assert.ok(
        ['Imported', 'Referenced'].includes(edge.kind),
        'Unknown native incoming edge kind',
      );
      assert.equal(typeof edge.specifier, 'string');
    }
  }
  assert.ok(
    Array.isArray(interop.incomingEdges) && interop.incomingEdges.length > 0,
    'Actual native boundary edges are required',
  );
  const graphByTarget = new Map(graph);
  for (const edge of interop.incomingEdges) {
    const bytes = files.get(edge.from);
    assert.ok(
      bytes && files.has(edge.to),
      'Native boundary edge must have tested source and target',
    );
    assert.ok(
      Number.isSafeInteger(edge.line) && edge.line > 0,
      'Native boundary edge requires an actual source line',
    );
    assert.equal(
      bytes.toString('utf8').split(/\r?\n/u)[edge.line - 1],
      edge.sourceStatement,
      'Checked boundary source statement changed',
    );
    assert.equal(
      sha256(Buffer.from(`${edge.sourceStatement}\n`)),
      edge.sourceStatementSha256,
      'Checked boundary source statement digest differs',
    );
    assert.ok(
      graphByTarget
        .get(edge.to)
        .some(incoming =>
          ['kind', 'specifier', 'from', 'to'].every(
            key => incoming[key] === edge[key],
          ),
        ),
      'Native boundary edge is absent from the actual incoming graph',
    );
  }
  return { files, program, interop };
}

function edgeKind(edge) {
  if (
    edge.kind === 'Imported' &&
    /^import type \* as \w+ from ['"][^'"]+['"];?$/u.test(edge.sourceStatement)
  )
    return 'import type namespace';
  if (
    edge.kind === 'Imported' &&
    /^export type \* from ['"][^'"]+['"];?$/u.test(edge.sourceStatement)
  )
    return 'export type *';
  if (
    edge.kind === 'Referenced' &&
    /^\/\/\/ <reference path=['"][^'"]+['"]\s*\/>$/u.test(edge.sourceStatement)
  )
    return 'triple-slash reference path';
  assert.fail(
    'Boundary edge is not an observed supported type-only source statement',
  );
}

/** Locate the type package through the file actually loaded by the native checker. */
export function resolveCheckedReactPackage({ files, interop }) {
  assert.ok(
    Array.isArray(interop.reactFiles),
    'Actual checked React declaration facts are required',
  );
  const indexes = interop.reactFiles.filter(
    file => file.packagePath === '@types/react/index.d.ts',
  );
  assert.equal(
    indexes.length,
    1,
    'Exactly one actual checked React index is required',
  );
  const index = indexes[0];
  const bytes = checkedBytes(index, 'Checked React index');
  assert.ok(
    files.get(index.realpath)?.equals(bytes),
    'React package owner must come from the actual checked file closure',
  );
  assert.equal(path.basename(index.realpath), 'index.d.ts');
  const root = path.dirname(index.realpath);
  const manifestFile = fs.realpathSync(path.join(root, 'package.json'));
  const manifest = readJson(manifestFile);
  assert.equal(
    manifest.name,
    '@types/react',
    'Checked React declaration package identity changed',
  );
  assert.deepEqual(
    interop.reactPackage,
    { name: manifest.name, version: manifest.version },
    'Checked React declaration package version changed',
  );
  return { root, manifestFile, manifest };
}

/** Export only a successful, unchanged, physically installed native admission. */
export async function exportOctaneTypeEvidence({
  toolingEvidenceFile,
  evidenceOut,
  corpusDir,
}) {
  for (const [name, file] of Object.entries({
    toolingEvidenceFile,
    evidenceOut,
    corpusDir,
  }))
    assert.ok(
      typeof file === 'string' && path.isAbsolute(file),
      `Explicit absolute ${name} is required`,
    );
  const receiptPath = fs.realpathSync(toolingEvidenceFile);
  const consumerRoot = path.dirname(receiptPath);
  const receiptBytes = fs.readFileSync(receiptPath);
  const receipt = JSON.parse(receiptBytes);
  const { files, program, interop } = validateOctaneToolingReceipt(receipt);
  const manifestFile = path.join(consumerRoot, 'package.json');
  const require = createRequire(manifestFile);
  const admission = readJson(manifestFile).ultramodernAdmission;
  assert.ok(
    admission?.nativeArtifact && admission.nativeRouterArtifact,
    'Installed maintained core and router admission identities are required',
  );
  const verified = await validateAdmissionPackages({
    root: consumerRoot,
    workspacePath: admission.workspacePath,
    nativeArtifact: admission.nativeArtifact,
    nativeRouterArtifact: admission.nativeRouterArtifact,
  });
  for (const key of ['nativeArtifact', 'nativeRouterArtifact'])
    assert.deepEqual(
      interop[key],
      verified[key],
      `Checked ${key} identity or installed bytes changed`,
    );

  const checker = receipt.nativeChecker;
  const sdkManifest = fs.realpathSync(
    require.resolve('@modern-js/renderer-octane/package.json'),
  );
  const sdk = readJson(sdkManifest);
  assert.equal(
    typeof sdk.bin?.['octane-tsc'],
    'string',
    'Installed owning SDK must expose its native checker',
  );
  const checkerBin = fs.realpathSync(
    path.resolve(path.dirname(sdkManifest), sdk.bin['octane-tsc']),
  );
  assert.equal(checker.bin, checkerBin, 'Checked SDK binary identity changed');
  assert.equal(checker.publicApi, '@modern-js/renderer-octane/typecheck');
  const publicApi = fs.realpathSync(require.resolve(checker.publicApi));
  assert.ok(checker.sdk, 'Actual checked SDK file identities are required');
  for (const [key, file] of Object.entries({
    manifest: sdkManifest,
    bin: checkerBin,
    publicApi,
  })) {
    assert.equal(
      checker.sdk[key]?.realpath,
      file,
      `Checked SDK ${key} path changed`,
    );
    checkedBytes(checker.sdk[key], `Checked SDK ${key}`);
  }
  const compilerManifest = fs.realpathSync(
    require.resolve('typescript/package.json'),
  );
  assert.equal(readJson(compilerManifest).version, '7.0.2');
  assert.equal(
    checker.samePhysicalCompiler,
    compilerManifest,
    'Checked stable compiler identity changed',
  );
  const checkerRequire = createRequire(checkerBin);
  assert.equal(
    fs.realpathSync(checkerRequire.resolve('typescript/package.json')),
    compilerManifest,
    'Owning checker must share physical stable TypeScript',
  );
  const compilerEntry = fs.realpathSync(
    require.resolve('octane/compiler/volar'),
  );
  assert.equal(
    fs.realpathSync(checkerRequire.resolve('octane/compiler/volar')),
    compilerEntry,
    'Owning checker must share physical native projection compiler',
  );
  assert.deepEqual(
    readJson(path.join(consumerRoot, 'tsconfig.json')).compilerOptions,
    program.config.compilerOptions,
    'Checked consumer compiler options changed',
  );

  const nativeRoot = verified.nativeArtifact.packageRoot;
  const { root: reactRoot } = resolveCheckedReactPackage({ files, interop });
  const packagePath = file => {
    for (const [name, directory] of [
      ['octane', nativeRoot],
      ['@types/react', reactRoot],
    ])
      if (within(directory, file))
        return `${name}/${path.relative(directory, file).split(path.sep).join('/')}`;
    assert.fail(
      'Boundary declaration is outside its actual native or React type package',
    );
  };
  const declaration = fact => {
    const bytes = checkedBytes(fact, 'Native declaration');
    assert.ok(
      files.get(fact.realpath)?.equals(bytes),
      'Native declaration was not actually checked',
    );
    assert.equal(fact.packagePath, packagePath(fact.realpath));
    return {
      packagePath: fact.packagePath,
      installedPath: fact.realpath,
      sha256: fact.sha256,
      size: fact.size,
      ...(fact.owningNativeRole
        ? { owningNativeRole: fact.owningNativeRole }
        : {}),
    };
  };
  assert.ok(
    Array.isArray(interop.nativeOwnerDeclarations) &&
      interop.nativeOwnerDeclarations.length > 0,
  );
  const nativeFiles = interop.nativeOwnerDeclarations
    .filter(fact => files.has(fact.realpath))
    .map(declaration);
  assert.ok(
    nativeFiles.length > 0,
    'Actual checked native owner declarations are required',
  );
  assert.ok(
    Array.isArray(interop.reactFiles) && interop.reactFiles.length > 0,
    'Actual checked React declaration facts are required',
  );
  const reactFiles = interop.reactFiles.map(declaration);
  const reactPaths = reactFiles.map(file => file.installedPath).sort();
  assert.deepEqual(
    [...receipt.rendererOwnedJsxTypeFiles].sort(),
    reactPaths,
    'Checked React declaration closure differs',
  );
  assert.deepEqual(
    [...files.keys()].filter(file => within(reactRoot, file)).sort(),
    reactPaths,
    'React declaration evidence must retain its entire checked package closure',
  );
  const authenticated = new Set(
    [...nativeFiles, ...reactFiles].map(file => file.installedPath),
  );
  const incomingEdges = interop.incomingEdges.map(edge => {
    assert.ok(
      authenticated.has(edge.from) && authenticated.has(edge.to),
      'Observed boundary edge must use authenticated checked declarations',
    );
    return {
      from: packagePath(edge.from),
      to: packagePath(edge.to),
      line: edge.line,
      specifier: edge.specifier,
      kind: edgeKind(edge),
      owningProvider: within(nativeRoot, edge.from)
        ? 'octane'
        : `@types/react@${interop.reactPackage.version}`,
      sourceStatement: edge.sourceStatement,
      sourceStatementSha256: edge.sourceStatementSha256,
    };
  });
  assert.deepEqual(
    interop.scopedRuntimeAbsenceVerified,
    [
      { name: 'consumer', directory: consumerRoot },
      { name: 'octane', directory: nativeRoot },
      {
        name: '@octanejs/tanstack-router',
        directory: verified.nativeRouterArtifact.packageRoot,
      },
    ],
    'Runtime absence must retain the actual consumer, core and router scopes',
  );
  for (const scope of interop.scopedRuntimeAbsenceVerified) {
    const scopedRequire = createRequire(
      path.join(scope.directory, 'package.json'),
    );
    for (const name of ['react', 'react-dom'])
      assert.throws(
        () => scopedRequire.resolve(name),
        { code: 'MODULE_NOT_FOUND' },
        `Unexpected ${name} runtime in ${scope.name}`,
      );
  }

  const authority = {
    schemaVersion: 1,
    consumerRoot,
    declaredScope: {
      provider: verified.nativeArtifact.name,
      providerVersion: verified.nativeArtifact.version,
      upstreamCommit: verified.nativeArtifact.upstreamCommit,
      nativeRouterVersion: verified.nativeRouterArtifact.version,
      reactTypesPackage: interop.reactPackage.name,
      reactTypesVersion: interop.reactPackage.version,
      exactPermittedFiles: reactFiles.map(file => file.packagePath),
      permission: 'Native-authored JSX type-only interop boundary',
      observedScope: interop.declaredScope,
      domTaxonomyOnly: interop.domTaxonomyOnly,
      blanketReactTypeException: interop.blanketReactTypeException,
    },
    nativeSourcePackage: verified.nativeArtifact,
    nativeRouterPackage: verified.nativeRouterArtifact,
    nativeFiles,
    reactFiles,
    incomingEdges,
    evidence: {
      toolingReceipt: {
        realpath: receiptPath,
        size: receiptBytes.length,
        sha256: sha256(receiptBytes),
      },
      nativeChecker: checker,
      nativeDeclarationInterfaces: receipt.nativeDeclarationInterfaces,
      canonicalTypeProgramSha256: interop.canonicalTypeProgramSha256,
      canonicalIncomingGraphSha256: interop.canonicalIncomingGraphSha256,
      checkedFileCount: files.size,
      incomingEdgeCount: interop.incomingGraph.reduce(
        (count, [, edges]) => count + edges.length,
        0,
      ),
      incomingGraph: interop.incomingGraph,
      scopedRuntimeAbsenceVerified: interop.scopedRuntimeAbsenceVerified,
      foreignRendererTypes: interop.foreignRendererTypes,
      foreignRendererAugmentations: interop.foreignRendererAugmentations,
    },
  };
  const authorityBytes = jsonBytes(authority);
  const outputs = new Map();
  const corpusFiles = [...files]
    .filter(
      ([file]) =>
        /\.d\.[cm]?ts$/u.test(file) &&
        (within(nativeRoot, file) || within(reactRoot, file)),
    )
    .map(([file, bytes]) => {
      const name = packagePath(file);
      const relative = `declarations/${name.replaceAll('/', '__')}.txt`;
      assert.ok(
        !outputs.has(relative),
        'Declaration corpus file names collide',
      );
      outputs.set(relative, bytes);
      return {
        packagePath: name,
        file: relative,
        size: bytes.length,
        sha256: sha256(bytes),
      };
    })
    .sort((left, right) => left.packagePath.localeCompare(right.packagePath));
  for (const file of [...nativeFiles, ...reactFiles])
    assert.ok(
      corpusFiles.some(item => item.packagePath === file.packagePath),
      'Authenticated declaration must be in the actual checked corpus',
    );
  const licenses = [
    ['octane', nativeRoot],
    ['@types/react', reactRoot],
  ].map(([owner, directory]) => {
    const bytes = fs.readFileSync(path.join(directory, 'LICENSE'));
    const relative = `licenses/${owner.replaceAll('/', '__')}.txt`;
    outputs.set(relative, bytes);
    return { owner, file: relative, size: bytes.length, sha256: sha256(bytes) };
  });
  const provenance = readJson(verified.nativeArtifact.provenancePath);
  const corpus = {
    schemaVersion: 1,
    purpose:
      'Actual native TypeScript-tested declaration bytes for scanner unit tests; the corpus does not qualify a runtime.',
    authoritySha256: sha256(authorityBytes),
    nativeSource: {
      name: verified.nativeArtifact.name,
      version: verified.nativeArtifact.version,
      archiveSha256: verified.nativeArtifact.sha256,
      url: provenance.artifact.intendedReleaseURI,
    },
    reactTypes: interop.reactPackage,
    files: corpusFiles,
    licenses,
  };
  const corpusBytes = jsonBytes(corpus);
  outputs.set('corpus.json', corpusBytes);
  const destinations = [...outputs].map(([relative, bytes]) => [
    path.join(corpusDir, relative),
    bytes,
  ]);
  destinations.push([evidenceOut, authorityBytes]);
  for (const [file] of destinations)
    assert.ok(
      !files.has(path.resolve(file)) && path.resolve(file) !== receiptPath,
      'Export must not overwrite checked input files',
    );
  for (const [file, bytes] of destinations) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  return {
    evidenceOut,
    authoritySha256: sha256(authorityBytes),
    corpusDir,
    corpusSha256: sha256(corpusBytes),
    checkedFileCount: files.size,
    declarationCount: corpusFiles.length,
    nativeDeclarationCount: nativeFiles.length,
    reactDeclarationCount: reactFiles.length,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = {};
  const flags = {
    '--tooling-evidence': 'toolingEvidenceFile',
    '--evidence-out': 'evidenceOut',
    '--corpus-dir': 'corpusDir',
  };
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = flags[process.argv[index]];
    assert.ok(
      key && process.argv[index + 1] && !options[key],
      'Expected --tooling-evidence, --evidence-out and --corpus-dir once each',
    );
    options[key] = process.argv[index + 1];
  }
  console.log(JSON.stringify(await exportOctaneTypeEvidence(options), null, 2));
}
