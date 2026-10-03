import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const publicPackageName = '@bleedingdev/modern-js-renderer-octane';
export const publicEntries = Object.freeze({
  client: 'browser',
  router: 'browser',
  server: 'host',
  manifest: 'host',
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

/** Each entry is an independent public import program with no inherited config. */
export function createPublicProgram(entry, fixtureFile) {
  assert.ok(Object.hasOwn(publicEntries, entry), 'Unknown Octane public entry');
  return {
    compilerOptions: {
      target: 'ESNext',
      lib: ['ESNext', 'DOM', 'DOM.Iterable'],
      module: 'preserve',
      moduleResolution: 'Bundler',
      moduleDetection: 'force',
      jsx: 'preserve',
      jsxImportSource: 'octane',
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
      types: publicEntries[entry] === 'browser' ? [] : ['node'],
    },
    tsrx: { compiler: 'octane/compiler/volar', platform: 'web' },
    files: [fixtureFile],
    include: [],
    exclude: [],
  };
}

function rejectFixtureEscapes(ts, source, ast) {
  assert.ok(
    !/@(?:ts-ignore|ts-expect-error|ts-nocheck)|@jsxImportSource/u.test(source),
    'Public fixtures cannot suppress checking or override JSX',
  );
  function visit(node) {
    assert.ok(
      !ts.isAsExpression(node) && !ts.isTypeAssertion(node),
      'Public fixtures cannot cast across SDK boundaries',
    );
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      assert.ok(
        specifier.startsWith(`${publicPackageName}/`) ||
          specifier.startsWith('@bleedingdev/modern-js-renderer-core/') ||
          specifier === 'octane' ||
          specifier.startsWith('octane/'),
        `Public fixture import escapes its native installed contract: ${specifier}`,
      );
    }
    node.forEachChild(visit);
  }
  visit(ast);
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

/**
 * Reuses an already installed packed hand-authored consumer. The caller merges
 * these roots into its existing authenticated app audit while they still exist.
 * No package install or build occurs.
 */
export async function runOctanePublicPrograms({
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
    'The authenticated installed-artifact audit callback is required',
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
  const typescript = await installedPackage(require, 'typescript', root);
  const checkerPackage = sdk;
  assert.equal(
    typescript.manifest.version,
    '7.0.2',
    'The admitted native declaration host is TypeScript 7.0.2',
  );
  const checkerBin = checkerPackage.manifest.bin?.['octane-tsc'];
  assert.equal(
    typeof checkerBin,
    'string',
    'The installed Octane SDK must expose octane-tsc',
  );
  const checker = await fs.realpath(
    path.resolve(checkerPackage.root, checkerBin),
  );
  assert.ok(
    inside(checkerPackage.root, checker),
    'The checker binary must belong to its installed package',
  );
  const checkerTypescript = await installedPackage(
    createRequire(checker),
    'typescript',
    root,
  );
  assert.equal(
    checkerTypescript.root,
    typescript.root,
    'The native checker and authored declaration resolver must share the same physical TypeScript 7.0.2',
  );
  assert.equal(require('typescript').version, '7.0.2');
  const ts = await import(require.resolve('typescript/unstable/ast'));
  const { API } = await import(require.resolve('typescript/unstable/sync'));
  assert.throws(
    () => require.resolve('react'),
    { code: 'MODULE_NOT_FOUND' },
    'The native consumer cannot install React runtime',
  );
  const owned = await fs.mkdtemp(path.join(output, 'octane-sdk-public-'));
  const programs = [];
  const entryFiles = [];
  const apis = [];
  const checkedSources = new Map();
  try {
    for (const [entry, role] of Object.entries(publicEntries)) {
      const source = await fs.readFile(
        path.join(fixtureDirectory, `${entry}.ts`),
        'utf8',
      );
      const fixture = path.join(owned, `${entry}.ts`);
      assert.ok(
        source.includes(`${publicPackageName}/${entry}`),
        'Each fixture must import its actual mapped public subpath',
      );
      await fs.writeFile(fixture, source, { flag: 'wx' });
      const config = createPublicProgram(entry, `./${entry}.ts`);
      const configBytes = `${JSON.stringify(config, null, 2)}\n`;
      const configFile = path.join(owned, `${entry}.json`);
      await fs.writeFile(configFile, configBytes, { flag: 'wx' });
      const api = new API({ cwd: app });
      apis.push(api);
      const project = api
        .updateSnapshot({ openProjects: [configFile] })
        .getProject(configFile);
      assert.ok(project, `Native TypeScript did not load /${entry}`);
      const program = project.program;
      const fixtureAst = program.getSourceFile(fixture);
      assert.ok(
        fixtureAst,
        'The native checker must load the authored public fixture',
      );
      rejectFixtureEscapes(ts, source, fixtureAst);
      let moduleImport;
      fixtureAst.forEachChild(node => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text === `${publicPackageName}/${entry}`
        )
          moduleImport = node;
      });
      assert.ok(moduleImport, `Missing public import /${entry}`);
      const moduleSymbol = project.checker.getSymbolAtLocation(
        moduleImport.moduleSpecifier,
      );
      const selectedFiles =
        moduleSymbol?.declarations.flatMap(declaration => {
          const node = declaration.resolve(project);
          return node ? [node.getSourceFile().fileName] : [];
        }) ?? [];
      assert.equal(
        selectedFiles.length,
        1,
        `The actual native import /${entry} must select one packed module`,
      );
      const selectedDeclaration = await fs.realpath(selectedFiles[0]);
      assert.equal(
        selectedDeclaration,
        await fs.realpath(path.join(sdk.root, 'dist/types', `${entry}.d.ts`)),
        `/${entry} must select its packed declaration, without source conditions or paths`,
      );
      const declaration = await sourceEvidence(selectedDeclaration, root);
      const command = await execute(
        nodeExecutable,
        [checker, '--project', configFile, '--pretty', 'false', '--listFiles'],
        app,
        timeoutMs,
      );
      assert.equal(
        command.exitCode,
        0,
        `Packed /${entry} typecheck failed:\n${command.stdout}${command.stderr}`,
      );
      assert.deepEqual(
        [
          ...program.getConfigFileParsingDiagnostics(),
          ...program.getProgramDiagnostics(),
          ...program.getGlobalDiagnostics(),
          ...program.getSyntacticDiagnostics(),
          ...program.getBindDiagnostics(),
          ...program.getSemanticDiagnostics(),
        ],
        [],
        `The actual native public API must accept /${entry}`,
      );
      const files = [];
      for (const file of program.getSourceFileNames()) {
        const evidence = await sourceEvidence(file, root);
        files.push(evidence);
        const sourceFile = program.getSourceFile(file);
        assert.ok(
          sourceFile,
          'Every audited source must belong to the actual native program',
        );
        checkedSources.set(evidence.path, sourceFile);
      }
      const checkerFiles = [];
      for (const file of command.stdout.split(/\r?\n/u)) {
        if (!file) continue;
        assert.ok(
          path.isAbsolute(file),
          'The packed checker must report absolute native program filenames',
        );
        checkerFiles.push(path.relative(root, await fs.realpath(file)));
      }
      assert.deepEqual(
        [...new Set(checkerFiles)].sort(),
        files.map(file => file.path).sort(),
        'The packed checker and the actual native API must check the same declaration closure',
      );
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
          !files.some(file => /(?:^|\/)@types\/node\//u.test(file.path)),
          `Browser /${entry} cannot acquire Node ambient declarations`,
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
      entryFiles.push(path.relative(root, fixture));
      programs.push({
        entry,
        role,
        specifier: `${publicPackageName}/${entry}`,
        source,
        sourceSha256: sha256(source),
        config,
        configSha256: sha256(configBytes),
        declaration,
        command: {
          command: nodeExecutable,
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
      nodeExecutable,
      [checker, '--project', invalidConfig, '--pretty', 'false'],
      app,
      timeoutMs,
    );
    assert.notEqual(
      negative.exitCode,
      0,
      'Native checker accepted an invalid authored public program',
    );
    assert.match(
      `${negative.stdout}${negative.stderr}`,
      /invalid\.ts\(1,\d+\): error TS2322/u,
      'The negative result must be the authored type error',
    );
    const programRoots = entryFiles.map(file => path.resolve(root, file));
    const audit = await auditProgramClosure({
      consumerRoot: root,
      applicationRoot: app,
      entryFiles: programRoots,
      programs,
    });
    assert.equal(audit.renderer, 'octane');
    for (const file of entryFiles)
      assert.ok(
        audit.entryClosure.some(record => record.path === file),
        'The common installed audit must include each actual SDK program root',
      );
    assert.equal(
      audit.nativeTypeInterop?.runtimeReactAllowed,
      false,
      'The existing authenticated native type-only interop audit is required',
    );
    const authenticated = new Map(
      audit.nativeTypeInterop.files.map(file => [file.path, file]),
    );
    for (const program of programs)
      for (const file of program.files) {
        assert.ok(
          !/(?:^|\/)node_modules\/(?:react(?:\/|$)|react-dom(?:\/|$)|react-server-dom-[^/]+\/|solid-js\/|@types\/react-dom\/|@tanstack\/(?:react-router|solid-router)\/)/u.test(
            file.path,
          ),
          'A foreign renderer entered the public declaration program',
        );
        if (/(?:^|\/)@types\/react(?:\/|$)/u.test(file.path))
          assert.equal(
            file.sha256,
            authenticated.get(file.path)?.sha256,
            'Every loaded React declaration must be authenticated native type-only interop',
          );
      }
    const files = new Map(
      programs.flatMap(program => program.files).map(file => [file.path, file]),
    );
    for (const file of files.values()) {
      const bytes = await fs.readFile(path.resolve(root, file.path));
      assert.equal(
        sha256(bytes),
        file.sha256,
        'The actual checked declaration closure changed during the common audit',
      );
      const ast = checkedSources.get(file.path);
      assert.ok(
        ast,
        'Foreign module inspection must use the actual native program AST',
      );
      function visit(node) {
        if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name))
          assert.ok(
            !/^(?:react(?:\/|$)|react-dom(?:\/|$)|@tanstack\/(?:react-router|solid-router)(?:\/|$))/u.test(
              node.name.text,
            ),
            'Foreign renderer module augmentation entered the actual public type program',
          );
        node.forEachChild(visit);
      }
      visit(ast);
    }
    return {
      passed: true,
      renderer: 'octane',
      qualification: 'independent-installed-mapped-public-sdk-programs',
      package: {
        name: sdk.manifest.name,
        version: sdk.manifest.version,
        manifestSha256: sdk.manifestSha256,
      },
      tooling: {
        typescript: '7.0.2',
        checkerPackage: sdk.manifest.name,
        checkerVersion: sdk.manifest.version,
        nativeApi: 'typescript/unstable/sync',
        typescriptManifestSha256: typescript.manifestSha256,
        checkerManifestSha256: checkerPackage.manifestSha256,
        checker: await sourceEvidence(checker, root),
      },
      programRoots,
      programLifetime: 'owned-temporary-roots-retired-after-common-audit',
      programs,
      negative: {
        exitCode: negative.exitCode,
        outputSha256: sha256(`${negative.stdout}${negative.stderr}`),
        diagnostic: 'TS2322',
      },
      nativeTypeInterop: audit.nativeTypeInterop,
      installedArtifactAudit: audit,
    };
  } finally {
    for (const api of apis) api.close();
    // Only the directory created by this invocation is retired.
    await fs.rm(owned, { recursive: true });
  }
}
