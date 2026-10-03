import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const publicPackageName = '@bleedingdev/modern-js-renderer-solid';
export const publicEntries = Object.freeze({
  client: { role: 'browser', extension: 'tsx' },
  router: { role: 'browser', extension: 'tsx' },
  server: { role: 'host', extension: 'ts' },
  manifest: { role: 'host', extension: 'ts' },
});

const fixtureDirectory = fileURLToPath(new URL('./fixtures/', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

/** Independent strict programs do not inherit application config or aliases. */
export function createPublicProgram(entry, fixtureFile) {
  assert.ok(Object.hasOwn(publicEntries, entry), 'Unknown Solid public entry');
  return {
    compilerOptions: {
      target: 'ESNext',
      lib: ['ESNext', 'DOM', 'DOM.Iterable'],
      module: 'preserve',
      moduleResolution: 'Bundler',
      moduleDetection: 'force',
      jsx: 'preserve',
      jsxImportSource: '@solidjs/web',
      isolatedModules: true,
      verbatimModuleSyntax: true,
      strict: true,
      noEmit: true,
      noCheck: false,
      skipLibCheck: false,
      allowImportingTsExtensions: true,
      allowJs: true,
      esModuleInterop: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
      noPropertyAccessFromIndexSignature: true,
      noImplicitReturns: true,
      resolveJsonModule: true,
      types: publicEntries[entry].role === 'browser' ? [] : ['node'],
    },
    files: [fixtureFile],
    include: [],
    exclude: [],
  };
}

function inspectAuthoredFixture(source, entry) {
  assert.ok(
    !/@(?:ts-ignore|ts-expect-error|ts-nocheck)|@jsxImportSource|\bas\s+[\w<{[]|\bdeclare\b/u.test(
      source,
    ),
    'Public fixtures cannot suppress checking, cast, augment, or override JSX',
  );
  assert.ok(
    !/\b(?:import|require)\s*\(/u.test(source),
    'Public fixtures use literal static native imports',
  );
  const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)].map(
    match => match[1],
  );
  assert.ok(
    imports.includes(`${publicPackageName}/${entry}`),
    'Each fixture imports its mapped public subpath',
  );
  for (const specifier of imports) {
    assert.ok(
      specifier.startsWith(`${publicPackageName}/`) ||
        specifier.startsWith('@bleedingdev/modern-js-renderer-core/') ||
        specifier === 'solid-js' ||
        specifier === '@solidjs/web',
      `Public fixture import escapes its installed native contract: ${specifier}`,
    );
  }
}

async function installedPackage(require, name, consumerRoot) {
  for (const directory of require.resolve.paths(name) ?? []) {
    const candidate = path.join(directory, name, 'package.json');
    try {
      const file = await fs.realpath(candidate);
      assert.ok(
        inside(consumerRoot, file),
        `Installed ${name} escapes the isolated consumer`,
      );
      const bytes = await fs.readFile(file);
      const manifest = JSON.parse(bytes);
      assert.equal(manifest.name, name, `Installed ${name} identity`);
      return {
        root: path.dirname(file),
        manifest,
        manifestSha256: sha256(bytes),
      };
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  throw new Error(`Missing installed public dependency ${name}`);
}

function execute(command, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let expired = false;
    let escalation;
    const timer = setTimeout(() => {
      expired = true;
      child.kill('SIGTERM');
      escalation = setTimeout(() => child.kill('SIGKILL'), 1_000);
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', bytes => {
      stdout += bytes;
    });
    child.stderr.setEncoding('utf8').on('data', bytes => {
      stderr += bytes;
    });
    child.on('error', error => {
      clearTimeout(timer);
      clearTimeout(escalation);
      reject(error);
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      if (expired)
        return reject(new Error('The packed public type program timed out'));
      resolve({ command, args, exitCode, signal, stdout, stderr });
    });
  });
}

async function sourceEvidence(file, consumerRoot) {
  const absolute = await fs.realpath(file);
  assert.ok(
    inside(consumerRoot, absolute),
    'Type program escaped the isolated consumer',
  );
  const bytes = await fs.readFile(absolute);
  return {
    path: path.relative(consumerRoot, absolute),
    sha256: sha256(bytes),
    size: bytes.length,
  };
}

function listedFiles(output) {
  return output
    .split(/\r?\n/u)
    .filter(
      line => !/^\s/u.test(line) && /\.(?:[cm]?tsx?|[cm]?jsx?)$/u.test(line),
    );
}

async function nativeBackendPackage(executable, checker, consumerRoot) {
  let directory = path.dirname(executable);
  while (inside(consumerRoot, directory)) {
    try {
      const filename = path.join(directory, 'package.json');
      const bytes = await fs.readFile(filename);
      const manifest = JSON.parse(bytes);
      assert.equal(
        checker.manifest.optionalDependencies?.[manifest.name],
        manifest.version,
        'The selected native binary must belong to the checker declared platform package',
      );
      assert.equal(
        manifest.version,
        checker.manifest.version,
        'The native platform and checker packages must share one exact version',
      );
      return {
        name: manifest.name,
        version: manifest.version,
        manifest: await sourceEvidence(filename, consumerRoot),
      };
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(
    'The selected native checker executable lacks its declared installed platform package',
  );
}

/** Reuses an authenticated installed consumer; never installs, packs or builds. */
export async function runSolidPublicPrograms({
  consumerRoot,
  applicationRoot = consumerRoot,
  outputDirectory,
  nodeExecutable = process.execPath,
  timeoutMs = 60_000,
  auditProgramClosure,
}) {
  assert.equal(
    typeof auditProgramClosure,
    'function',
    'The authenticated installed-program auditor is required',
  );
  const root = await fs.realpath(consumerRoot);
  const app = await fs.realpath(applicationRoot);
  assert.ok(
    inside(root, app),
    'The public type application must belong to its consumer',
  );
  const output = await fs.realpath(outputDirectory);
  assert.ok(
    inside(app, output),
    'The public program output must belong to the installed application',
  );
  const require = createRequire(path.join(app, 'package.json'));
  const sdk = await installedPackage(require, publicPackageName, root);
  const checkerPackage = await installedPackage(require, '@effect/tsgo', root);
  assert.equal(
    checkerPackage.manifest.version,
    '0.45.0',
    'The admitted Solid checker is @effect/tsgo0.45.0',
  );
  const provider = await installedPackage(require, 'typescript', root);
  assert.equal(
    provider.manifest.version,
    '7.0.2',
    'The Solid native TypeScript provider must use its admitted exact version',
  );
  assert.equal(
    typeof provider.manifest.gitHead,
    'string',
    'The native checker provider must carry its source identity',
  );
  const selector = await fs.realpath(
    require.resolve('@effect/tsgo/lib/getExePath'),
  );
  assert.ok(
    inside(checkerPackage.root, selector),
    'The public native checker selector must belong to its installed package',
  );
  const selectorEvidence = await sourceEvidence(selector, root);
  const selected = await execute(
    nodeExecutable,
    [
      '--input-type=module',
      '--eval',
      `const { default: getExePath } = await import(${JSON.stringify(pathToFileURL(selector).href)}); process.stdout.write(getExePath());`,
    ],
    app,
    timeoutMs,
  );
  assert.equal(
    selected.exitCode,
    0,
    `The installed public native checker selector failed: ${selected.stderr}`,
  );
  const checker = await fs.realpath(selected.stdout.trim());
  assert.ok(
    inside(root, checker),
    'The selected native checker must belong to the isolated consumer',
  );
  const backend = await nativeBackendPackage(checker, checkerPackage, root);
  const checkerEvidence = await sourceEvidence(checker, root);
  const toolingFiles = [
    selectorEvidence,
    checkerEvidence,
    backend.manifest,
    await sourceEvidence(path.join(checkerPackage.root, 'package.json'), root),
    await sourceEvidence(path.join(provider.root, 'package.json'), root),
    await sourceEvidence(path.join(sdk.root, 'package.json'), root),
  ];
  const checkerCommand = checker;
  const checkerArguments = [];
  const version = await execute(
    checkerCommand,
    [...checkerArguments, '--version'],
    app,
    timeoutMs,
  );
  assert.equal(
    version.exitCode,
    0,
    'The installed native checker must identify itself',
  );
  assert.match(
    version.stdout,
    /\b7\.0\.2\b/u,
    'The selected checker must use its admitted native TypeScript7 backend',
  );
  assert.throws(
    () => require.resolve('react'),
    { code: 'MODULE_NOT_FOUND' },
    'The Solid consumer cannot install React runtime',
  );
  const owned = await fs.mkdtemp(path.join(output, 'solid-sdk-public-'));
  const programs = [];
  const entryFiles = [];
  try {
    for (const [entry, { role, extension }] of Object.entries(publicEntries)) {
      const source = await fs.readFile(
        path.join(fixtureDirectory, `${entry}.${extension}`),
        'utf8',
      );
      const fixture = path.join(owned, `${entry}.${extension}`);
      inspectAuthoredFixture(source, entry);
      await fs.writeFile(fixture, source, { flag: 'wx' });
      const config = createPublicProgram(entry, `./${entry}.${extension}`);
      const configBytes = `${JSON.stringify(config, null, 2)}\n`;
      const configFile = path.join(owned, `${entry}.json`);
      await fs.writeFile(configFile, configBytes, { flag: 'wx' });
      const declarationTarget = sdk.manifest.exports?.[`./${entry}`]?.types;
      assert.equal(
        declarationTarget,
        `./dist/types/${entry}.d.ts`,
        'The public subpath must declare its packed type target',
      );
      const selectedDeclaration = await fs.realpath(
        path.join(sdk.root, declarationTarget),
      );
      const declaration = await sourceEvidence(selectedDeclaration, root);
      const runtime = await sourceEvidence(
        require.resolve(`${publicPackageName}/${entry}`),
        root,
      );
      assert.ok(
        runtime.path.includes('/dist/'),
        'The actual public runtime export must select a packed distribution',
      );
      const command = await execute(
        checkerCommand,
        [
          ...checkerArguments,
          '--project',
          configFile,
          '--pretty',
          'false',
          '--noCheck',
          'false',
          '--skipLibCheck',
          'false',
          '--explainFiles',
        ],
        app,
        timeoutMs,
      );
      assert.equal(
        command.exitCode,
        0,
        `Packed /${entry} typecheck failed:\n${command.stdout}${command.stderr}`,
      );
      const files = [];
      for (const file of listedFiles(command.stdout))
        files.push(await sourceEvidence(path.resolve(app, file), root));
      assert.ok(
        files.some(file => file.path === path.relative(root, fixture)),
        'The checker must include the authored public fixture',
      );
      assert.ok(
        files.some(file => file.path === declaration.path),
        'The checker must include the actual packed declaration',
      );
      if (role === 'browser')
        assert.ok(
          !files.some(file =>
            /(?:^|\/)@types\/(?:node|react(?:-dom)?)\//u.test(file.path),
          ),
          `Browser /${entry} cannot acquire Node or React ambient declarations`,
        );
      for (const file of files)
        assert.ok(
          !/(?:^|\/)(?:react|react-dom|octane|@tanstack\/(?:react-router|solid-router)|@bleedingdev\/modern-js-renderer-octane)\//u.test(
            file.path,
          ),
          'A foreign native runtime or router entered the Solid declaration program',
        );
      assert.equal(
        sha256(await fs.readFile(configFile)),
        sha256(configBytes),
        'Public type config changed during checking',
      );
      assert.equal(
        sha256(await fs.readFile(fixture)),
        sha256(source),
        'Public type source changed during checking',
      );
      assert.equal(
        sha256(await fs.readFile(selectedDeclaration)),
        declaration.sha256,
        'Packed declaration changed during checking',
      );
      entryFiles.push(fixture);
      programs.push({
        entry,
        role,
        specifier: `${publicPackageName}/${entry}`,
        root: path.relative(root, fixture),
        configPath: path.relative(root, configFile),
        source,
        sourceSha256: sha256(source),
        config,
        configSha256: sha256(configBytes),
        declaration,
        runtime,
        command: {
          command: checkerCommand,
          args: command.args,
          exitCode: command.exitCode,
          stdoutSha256: sha256(command.stdout),
          stderrSha256: sha256(command.stderr),
        },
        files: files.sort((left, right) => left.path.localeCompare(right.path)),
      });
    }
    const invalid = path.join(owned, 'invalid.ts');
    await fs.writeFile(
      invalid,
      "export const invalid: number = 'native-checker-must-reject';\n",
      { flag: 'wx' },
    );
    const invalidConfig = path.join(owned, 'invalid.json');
    await fs.writeFile(
      invalidConfig,
      JSON.stringify(createPublicProgram('client', './invalid.ts')),
      { flag: 'wx' },
    );
    const negative = await execute(
      checkerCommand,
      [
        ...checkerArguments,
        '--project',
        invalidConfig,
        '--pretty',
        'false',
        '--noCheck',
        'false',
        '--skipLibCheck',
        'false',
      ],
      app,
      timeoutMs,
    );
    assert.notEqual(
      negative.exitCode,
      0,
      'The native checker accepted an invalid authored public program',
    );
    assert.match(
      `${negative.stdout}${negative.stderr}`,
      /invalid\.ts\(1,\d+\): error TS2322/u,
      'The negative result must be the authored type error',
    );
    const audit = await auditProgramClosure({
      consumerRoot: root,
      applicationRoot: app,
      entryFiles,
      programs,
    });
    assert.equal(audit.renderer, 'solid');
    for (const fixture of entryFiles)
      assert.ok(
        audit.entryClosure?.some(
          file => file.path === path.relative(root, fixture),
        ),
        'The authenticated artifact audit must include each actual SDK program',
      );
    const files = new Map(
      programs.flatMap(program => program.files).map(file => [file.path, file]),
    );
    for (const file of files.values()) {
      const bytes = await fs.readFile(path.resolve(root, file.path));
      assert.equal(
        sha256(bytes),
        file.sha256,
        'The checked declaration closure changed during the common artifact audit',
      );
      assert.ok(
        !/\bdeclare\s+module\s*['"](?:react|react-dom|octane|@tanstack\/(?:react-router|solid-router))(?:['"/])/u.test(
          bytes.toString('utf8'),
        ),
        'Foreign renderer module augmentation entered the actual public type program',
      );
      assert.ok(
        !/(?:^|\/)@types\/react(?:-dom)?\//u.test(file.path),
        'React declarations entered the Solid public type program',
      );
    }
    for (const program of programs) {
      assert.equal(
        sha256(await fs.readFile(path.resolve(root, program.root))),
        program.sourceSha256,
        'The public program changed during artifact auditing',
      );
      assert.equal(
        sha256(await fs.readFile(path.resolve(root, program.configPath))),
        program.configSha256,
        'The strict program config changed during artifact auditing',
      );
      assert.equal(
        sha256(await fs.readFile(path.resolve(root, program.runtime.path))),
        program.runtime.sha256,
        'The resolved public runtime export changed during artifact auditing',
      );
    }
    for (const file of toolingFiles)
      assert.equal(
        sha256(await fs.readFile(path.resolve(root, file.path))),
        file.sha256,
        'The selected checker or package identity changed during public program execution',
      );
    return {
      passed: true,
      renderer: 'solid',
      qualification: 'independent-installed-mapped-public-sdk-programs',
      execution: 'typecheck-only',
      runtimeExports: 'resolved-without-execution',
      package: {
        name: sdk.manifest.name,
        version: sdk.manifest.version,
        manifestSha256: sdk.manifestSha256,
      },
      tooling: {
        checker: checkerEvidence,
        selector: selectorEvidence,
        selectorCommand: {
          command: nodeExecutable,
          args: selected.args,
          exitCode: selected.exitCode,
          stdoutSha256: sha256(selected.stdout),
          stderrSha256: sha256(selected.stderr),
        },
        nativeBackend: backend,
        nativeProvider: {
          name: provider.manifest.name,
          version: provider.manifest.version,
          gitHead: provider.manifest.gitHead,
          manifestSha256: provider.manifestSha256,
        },
        name: checkerPackage.manifest.name,
        version: checkerPackage.manifest.version,
        manifestSha256: checkerPackage.manifestSha256,
        declaredDependencies: checkerPackage.manifest.dependencies ?? {},
        nativeVersion: version.stdout.trim(),
        nativeVersionSha256: sha256(version.stdout),
      },
      programs,
      negative: {
        exitCode: negative.exitCode,
        outputSha256: sha256(`${negative.stdout}${negative.stderr}`),
        diagnostic: 'TS2322',
      },
      installedArtifactAudit: audit,
    };
  } finally {
    // The caller's registered application root owns this temporary child.
    await fs.rm(owned, { recursive: true });
  }
}
