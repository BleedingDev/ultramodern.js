import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  createIsolatedTestApp,
  modernBuild,
} from '../../../utils/modernTestUtils';

rstest.setConfig({ testTimeout: 1000 * 60 * 3, hookTimeout: 1000 * 60 * 3 });

const sourceApiAppDir = path.resolve(__dirname, '../bff-api-app');

// The fork type-checks with TS-Go, and the `typescript` package pinned here no
// longer exposes the legacy Program API (`ts.createProgram` and friends are
// undefined on 7.x), so the isolated consumer is checked by spawning the very
// compiler the framework itself uses.
const tsgoBin = (() => {
  const requireFromHere = createRequire(__filename);
  const pkgPath = requireFromHere.resolve(
    '@typescript/native-preview/package.json',
  );
  const pkgDir = path.dirname(pkgPath);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    bin?: string | { tsgo?: string };
  };
  const declared = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.tsgo;
  const candidates = [
    declared ? path.resolve(pkgDir, declared) : undefined,
    path.join(pkgDir, 'bin/tsgo.js'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find(candidate => fs.existsSync(candidate))!;
})();

/**
 * Type-check `consumerDir` in isolation and return the reported diagnostics.
 * An unused `@ts-expect-error` also surfaces here (TS2578), so a type that
 * silently degraded to `any` fails the check just like a missing declaration
 * would.
 */
function typeCheck(consumerDir: string): string[] {
  try {
    execFileSync(
      process.execPath,
      [tsgoBin, '--noEmit', '-p', path.join(consumerDir, 'tsconfig.json')],
      { stdio: 'pipe' },
    );
    return [];
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    return `${stdout?.toString() ?? ''}${stderr?.toString() ?? ''}`
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  }
}

const consumerSource = [
  `import portable from 'bff-api-app/api/portable';`,
  ``,
  `export async function check() {`,
  `  const msg = await portable();`,
  `  const from: string = msg.from;`,
  `  // @ts-expect-error 'message' is a string, so this must error. If the`,
  `  // type had degraded to any/unknown the directive would be unused (TS2578).`,
  `  const bad: number = msg.message;`,
  `  return { from, bad };`,
  `}`,
  ``,
].join('\n');

/**
 * Install the packed tarball by extracting it into an isolated `node_modules`
 * — no workspace symlink, no dependency hoisting, no path alias, no access to
 * the producer sources — and write the consumer that exercises the type.
 */
function createConsumer(
  root: string,
  name: string,
  tarball: string,
  compilerOptions: Record<string, unknown>,
  packageJson?: Record<string, unknown>,
) {
  const consumerDir = path.join(root, name);
  const pkgDir = path.join(consumerDir, 'node_modules', 'bff-api-app');
  fs.mkdirSync(pkgDir, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', pkgDir, '--strip-components=1'], {
    stdio: 'pipe',
  });

  fs.writeFileSync(path.join(consumerDir, 'index.ts'), consumerSource);
  if (packageJson) {
    fs.writeFileSync(
      path.join(consumerDir, 'package.json'),
      JSON.stringify(packageJson, null, 2),
    );
  }
  fs.writeFileSync(
    path.join(consumerDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          noEmit: true,
          strict: true,
          skipLibCheck: false,
          types: [],
          ...compilerOptions,
        },
        include: ['index.ts'],
      },
      null,
      2,
    ),
  );

  return { consumerDir, pkgDir };
}

describe('crossProject client type portability', () => {
  let workDir: string;
  let tarball: string;

  beforeAll(async () => {
    // Build and pack an isolated copy: index.test.ts serves the source fixture
    // from a parallel worker, and a build there would empty dist-1 underneath
    // the running server. Excluding dist-1 also prevents stale or half-written
    // declarations from entering the copy.
    const { appDir: apiAppDir, cleanup } = await createIsolatedTestApp(
      sourceApiAppDir,
      { exclude: ['dist-1'] },
    );
    try {
      // The generator fails closed when a handler declaration is missing, so a
      // successful build is itself part of the contract under test.
      const buildResult = (await modernBuild(apiAppDir, [], {})) as {
        code: number;
        stderr?: string;
      };
      expect(buildResult.stderr ?? '').not.toContain(
        'MissingClientDeclarationError',
      );
      expect(buildResult.code).toBe(0);

      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-portability-'));
      // Pack exactly what would be published.
      execFileSync('pnpm', ['pack', '--pack-destination', workDir], {
        cwd: apiAppDir,
        stdio: 'pipe',
      });
      const packed = fs
        .readdirSync(workDir)
        .find(name => name.endsWith('.tgz'));
      expect(packed).toBeTruthy();
      tarball = path.join(workDir, packed!);
    } finally {
      await cleanup();
    }
  });

  afterAll(() => {
    if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  // The published package must type-check for a consumer that has no access to
  // the source workspace. This is the real regression surface — "resolvable in
  // the local dist" is not the same as "resolvable from the packed tarball".
  it('a packed tarball resolves the client types from an isolated consumer', () => {
    const { consumerDir, pkgDir } = createConsumer(
      workDir,
      'consumer-bundler',
      tarball,
      { module: 'esnext', moduleResolution: 'bundler' },
    );

    // The declaration closure the client re-exports must actually ship.
    const shippedShared = path.join(pkgDir, 'dist-1', 'shared', 'types.d.ts');
    const shippedOrigin = path.join(
      pkgDir,
      'dist-1',
      'api',
      'lambda',
      'portable.d.ts',
    );
    const shippedFacade = path.join(
      pkgDir,
      'dist-1',
      'client',
      'portable.d.ts',
    );
    // A nested route proves the relative specifier is computed per client
    // location rather than assuming a flat `client/` directory.
    const shippedNestedFacade = path.join(
      pkgDir,
      'dist-1',
      'client',
      'user',
      'index.d.ts',
    );
    expect(fs.existsSync(shippedShared)).toBe(true);
    expect(fs.existsSync(shippedOrigin)).toBe(true);
    expect(fs.existsSync(shippedFacade)).toBe(true);
    expect(fs.existsSync(shippedNestedFacade)).toBe(true);

    // No tsconfig path alias may leak into the published declarations.
    expect(fs.readFileSync(shippedOrigin, 'utf8')).not.toContain('@shared');
    // The facade re-exports the in-place declaration, it does not copy it. The
    // specifier carries `.js` because the generated client directory is always
    // its own ESM package (`dist-1/client/package.json` declares
    // `type: module`), whatever module format the app itself compiles to.
    expect(fs.readFileSync(shippedFacade, 'utf8')).toContain(
      `from '../api/lambda/portable.js'`,
    );
    expect(fs.readFileSync(shippedNestedFacade, 'utf8')).toContain(
      `from '../../api/lambda/user/index.js'`,
    );

    expect(typeCheck(consumerDir)).toEqual([]);
  });

  // The `.js` in the facade specifier is a deliberate deviation from upstream,
  // which derives it from the app-level moduleType. Inside the always-ESM
  // client package an extensionless specifier is TS2834/TS2835 under
  // `node16`/`nodenext`, so the published facade must never resolve through
  // one.
  it('the published facade resolves its declaration under node16/nodenext', () => {
    const { consumerDir } = createConsumer(
      workDir,
      'consumer-nodenext',
      tarball,
      { module: 'nodenext', moduleResolution: 'nodenext' },
      { name: 'nodenext-consumer', private: true, type: 'module' },
    );

    // TS2307 (cannot find module) catches a facade that never shipped, and
    // TS2834/TS2835 catch one whose specifier lost its explicit extension.
    const resolutionFailures = typeCheck(consumerDir).filter(line =>
      /error TS(?:2307|2834|2835)\b/.test(line),
    );
    expect(resolutionFailures).toEqual([]);
  });
});
