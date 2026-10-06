import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSingleAppI18nCheck, runWorkspaceSourceCheck } from '../src';

type CapturedConsole = {
  readonly exitCode: number;
  readonly errors: readonly string[];
  readonly logs: readonly string[];
};

const createTempRoot = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-code-tools-test-'));

const writeFile = (
  root: string,
  relativePath: string,
  content: string,
): void => {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
};

const captureConsole = (callback: () => number): CapturedConsole => {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  console.log = (...args: unknown[]) => {
    logs.push(args.join(' '));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.join(' '));
  };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    logs.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    errors.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  try {
    return {
      exitCode: callback(),
      errors,
      logs,
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
};

const combinedOutput = ({ errors, logs }: CapturedConsole): string =>
  [...errors, ...logs].join('\n');

describe('@modern-js/code-tools', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const tempRoot of tempRoots.splice(0)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  const trackTempRoot = (): string => {
    const tempRoot = createTempRoot();
    tempRoots.push(tempRoot);
    return tempRoot;
  };

  test('single-app runner allows localized expressions, technical JSX text, ignores, and non-JSX strings', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'src/page.tsx',
      `
const t = (key: string) => key;
const outsideJsx = 'Visible words outside JSX are not user-visible JSX text';
const label = t('home.label');
const effectProgram = Effect.gen(function* () {
  yield* fetchUser<string>('literal outside JSX');
  return outsideJsx;
});
const genericValue = getValue<string>('raw literal outside JSX');
const genericProgram = Option.match(genericValue, {
  onNone: () => 'Fallback copy outside JSX',
  onSome: item => item,
});

export function Page() {
  return (
    <main aria-label={label} title={t('home.title')}>
      <p>{t('home.copy')}</p>
      <p>{' '}</p>
      <p>{123}</p>
      <code title="pnpm dev">pnpm dev</code>
      <kbd>Enter</kbd>
      <samp>ERR_RUNTIME_001</samp>
      {/* i18n-ignore */}
      <p>Intentional visible copy</p>
      <span>{effectProgram}</span>
      <span>{genericProgram}</span>
    </main>
  );
}
`,
    );

    const result = captureConsole(() => runSingleAppI18nCheck({ cwd: root }));

    expect(result.exitCode).toBe(0);
    expect(result.logs).toContain(
      'No hardcoded user-visible JSX strings found.',
    );
    expect(result.errors).toEqual([]);
  });

  test('single-app runner rejects literal JSX text and visible literal attributes', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'src/page.tsx',
      `
export function Page() {
  return (
    <main>
      <button
        aria-description="Button opens the dialog"
        aria-label="Open dialog"
        aria-roledescription="Primary action"
        aria-valuetext="Step one"
        title="Open the setup dialog"
      >
        Start setup
      </button>
      <img alt="Product screenshot" src="/demo.png" />
      <input placeholder="Search projects" />
    </main>
  );
}
`,
    );

    const result = captureConsole(() => runSingleAppI18nCheck({ cwd: root }));
    const output = combinedOutput(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain(
      'Hardcoded user-visible JSX strings found. Move copy to locale JSON files.',
    );
    expect(output).toContain('Start setup');
    expect(output).toContain('aria-description');
    expect(output).toContain('aria-roledescription');
    expect(output).toContain('aria-valuetext');
  });

  test('single-app runner rejects conditional literal JSX expression text', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'src/page.tsx',
      `
const t = (key: string) => key;

export function Page({ mode }: { mode: 'empty' | 'ready' }) {
  return <p>{mode === 'empty' ? 'No projects yet' : t('projects.ready')}</p>;
}
`,
    );

    const result = captureConsole(() => runSingleAppI18nCheck({ cwd: root }));
    const output = combinedOutput(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain('No projects yet');
  });

  test('workspace runner rejects startsWith locale copy branching', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'apps/shell/src/App.tsx',
      `
export function App({ language }: { language: string }) {
  const copy = language.startsWith('fr') ? 'Bonjour' : 'Hello';
  return <p>{copy}</p>;
}
`,
    );

    const result = captureConsole(() =>
      runWorkspaceSourceCheck({
        cwd: root,
        sourceRoots: ['apps'],
        locales: [],
      }),
    );
    const output = combinedOutput(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain('ultramodern(no-manual-locale-copy-branching)');
    expect(output).toContain(
      'Move locale-specific copy branch to i18n resources: "Bonjour"',
    );
  });

  test('workspace runner rejects legacy Module Federation boundary attributes', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'apps/shell/src/App.tsx',
      `
export function App() {
  return <section data-mf-boundary="shell" data-mf-remote="catalog" />;
}
`,
    );

    const result = captureConsole(() =>
      runWorkspaceSourceCheck({ cwd: root, sourceRoots: ['apps'] }),
    );

    expect(result.exitCode).toBe(1);
    expect(combinedOutput(result)).toContain('data-mf-* boundary attributes');
  });

  test.each(['server', 'hono-server'])(
    'workspace runner rejects raw API handler drift through Oxlint from %s',
    endpoint => {
      const root = trackTempRoot();
      writeFile(
        root,
        'verticals/catalog/api/index.ts',
        `
import { createHandler } from '@modern-js/plugin-bff/${endpoint}';

export const handler = async (request: Request) => {
  const body = await request.json();
  return Response.json(body);
};

export default async function fallback() {
  return new Response('legacy');
}

const runtimeFramework = 'hono';
const strictEffectApproach = false;
`,
      );

      const result = captureConsole(() =>
        runWorkspaceSourceCheck({
          cwd: root,
          sourceRoots: ['verticals'],
          locales: [],
        }),
      );
      const output = combinedOutput(result);

      expect(result.exitCode).toBe(1);
      expect(output).toContain('must not import Hono server helpers');
      expect(output).toContain(
        'use @modern-js/bff-effect/effect-edge and HttpApi',
      );
      expect(output).toContain('must not hand-build Response objects');
      expect(output).toContain('must not manually parse request bodies');
      expect(output).toContain('must not export raw request handlers');
      expect(output).toContain('must keep strictEffectApproach enabled');
    },
  );

  test('Hono diagnostics cover template imports without treating server-plugin as the Hono endpoint', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'apps/shell/src/runtime.ts',
      "import serverPlugin from '@modern-js/plugin-bff/server-plugin'; export const plugin = serverPlugin;\n",
    );
    const valid = captureConsole(() =>
      runWorkspaceSourceCheck({
        cwd: root,
        sourceRoots: ['apps'],
        locales: [],
      }),
    );
    expect(combinedOutput(valid)).not.toContain(
      'must not import Hono server helpers',
    );
    writeFile(
      root,
      'apps/shell/src/runtime.ts',
      'export const load = () => import(`@modern-js/plugin-bff/server`);\n',
    );
    const invalid = captureConsole(() =>
      runWorkspaceSourceCheck({
        cwd: root,
        sourceRoots: ['apps'],
        locales: [],
      }),
    );
    expect(invalid.exitCode).toBe(1);
    expect(combinedOutput(invalid)).toContain(
      'must not import Hono server helpers',
    );
  });

  test('workspace runner checks mts sources, shell API entries, schemas, and legacy API paths', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'verticals/catalog/shared/api.mts',
      `
export const raw = () => new Response('legacy');
`,
    );
    writeFile(
      root,
      'apps/shell-super-app/api/index.ts',
      `
export const runtime = {};
`,
    );
    writeFile(
      root,
      'apps/shell-super-app/shared/api.ts',
      `
import { Schema } from '@modern-js/bff-effect/effect-edge';

export const Payload = Schema.UnknownFromJsonString;
`,
    );
    writeFile(
      root,
      'verticals/catalog/api/effect/index.ts',
      `
export const program = Effect.succeed('legacy path');
`,
    );
    writeFile(
      root,
      'verticals/catalog/shared/api.ts',
      `
export type CatalogItem = {
  readonly id: string;
};
`,
    );

    const result = captureConsole(() =>
      runWorkspaceSourceCheck({
        cwd: root,
        sourceRoots: ['verticals', 'apps'],
        locales: [],
      }),
    );
    const output = combinedOutput(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain('must not hand-build Response objects');
    expect(output).toContain(
      'Generated API entries must export defineEffectBff',
    );
    expect(output).toContain('must implement handlers through HttpApiBuilder');
    expect(output).toContain('must use concrete request');
    expect(output).toContain('api/effect, api/lambda, shared/effect');
    expect(output).toContain('must declare an HttpApi contract');
    expect(output).toContain('must declare endpoints through HttpApiEndpoint');
  });

  test('workspace runner plural-checks additional configured locales instead of bypassing them', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'apps/shell/src/modern.runtime.ts',
      `
import deResource from '../locales/de/shell.json';
import enResource from '../locales/en/shell.json';

const resources = {
  de: deResource,
  en: enResource,
};

export default {
  i18n: {
    initOptions: {
      resources,
    },
  },
};
`,
    );
    writeFile(
      root,
      'apps/shell/locales/en/shell.json',
      JSON.stringify({
        items_one: '{{count}} item',
        items_other: '{{count}} items',
      }),
    );
    writeFile(
      root,
      'apps/shell/locales/de/shell.json',
      JSON.stringify({
        items_one: '{{count}} Artikel',
      }),
    );

    const result = captureConsole(() =>
      runWorkspaceSourceCheck({
        cwd: root,
        sourceRoots: ['apps'],
        locales: ['en', 'de'],
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toContain(
      'plural group .items is missing _other',
    );
  });

  test('workspace runner requires imports for every configured locale and honors plural-category overrides', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'apps/shell/src/modern.runtime.ts',
      `
import enResource from '../locales/en/shell.json';
import xxResource from '../locales/xx/shell.json';

const resources = {
  en: enResource,
  xx: xxResource,
};

export default {
  i18n: {
    initOptions: {
      resources,
    },
  },
};
`,
    );
    writeFile(
      root,
      'apps/shell/locales/en/shell.json',
      JSON.stringify({
        items_one: '{{count}} item',
        items_other: '{{count}} items',
      }),
    );
    writeFile(
      root,
      'apps/shell/locales/xx/shell.json',
      JSON.stringify({
        items_other: '{{count}} items',
      }),
    );

    const passing = captureConsole(() =>
      runWorkspaceSourceCheck({
        cwd: root,
        sourceRoots: ['apps'],
        locales: ['en', 'xx'],
        pluralCategories: { xx: ['other'] },
      }),
    );

    expect(passing.exitCode).toBe(0);
    expect(passing.errors).toEqual([]);

    const missingImport = captureConsole(() =>
      runWorkspaceSourceCheck({
        cwd: root,
        sourceRoots: ['apps'],
        locales: ['en', 'xx', 'fr'],
        pluralCategories: { xx: ['other'] },
      }),
    );

    expect(missingImport.exitCode).toBe(1);
    expect(missingImport.errors.join('\n')).toContain(
      'missing locale JSON imports for: fr',
    );
  });
});
