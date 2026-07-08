import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  oxlintPlugin,
  runSingleAppI18nCheck,
  runWorkspaceSourceCheck,
} from '../src';

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

  test('exports the Oxlint plugin and required runners', () => {
    expect(typeof runSingleAppI18nCheck).toBe('function');
    expect(typeof runWorkspaceSourceCheck).toBe('function');
    expect(oxlintPlugin.rules['no-hardcoded-jsx-text']).toBeDefined();
    expect(
      oxlintPlugin.rules['no-literal-visible-jsx-attributes'],
    ).toBeDefined();
    expect(oxlintPlugin.rules['strict-effect-api-boundaries']).toBeDefined();
  });

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

  test('single-app runner rejects literal JSX text and all visible literal attributes', () => {
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

  test('single-app runner does not flag TypeScript generic/effect helpers without JSX', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'src/effect.ts',
      `
const program = Effect.gen(function* () {
  const value = yield* getValue<string>('raw literal outside JSX');
  return Option.match(value, {
    onNone: () => 'Fallback copy outside JSX',
    onSome: item => item,
  });
});

export { program };
`,
    );

    const result = captureConsole(() => runSingleAppI18nCheck({ cwd: root }));

    expect(result.exitCode).toBe(0);
    expect(result.logs).toContain(
      'No hardcoded user-visible JSX strings found.',
    );
  });

  test('workspace runner allows modern boundary attributes and does not enforce hardcoded JSX text', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'apps/shell/src/App.tsx',
      `
const t = (key: string) => key;

export function App() {
  return (
    <section
      aria-label={t('workspace.shell.label')}
      data-modern-boundary-id="shell"
      data-modern-mf-expose="./Route"
      data-modern-mf-role="shell"
    >
      Hardcoded workspace source text is not part of this runner yet.
    </section>
  );
}
`,
    );
    writeFile(
      root,
      'apps/shell/src/modern.runtime.ts',
      `
import csResource from '../locales/cs/shell.json';
import enResource from '../locales/en/shell.json';

const resources = {
  cs: csResource,
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
      'apps/shell/locales/cs/shell.json',
      JSON.stringify({
        items_one: '{{count}} item',
        items_few: '{{count}} items',
        items_many: '{{count}} items',
        items_other: '{{count}} items',
      }),
    );

    const result = captureConsole(() =>
      runWorkspaceSourceCheck({ cwd: root, sourceRoots: ['apps'] }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.logs).toContain(
      'UltraModern i18n and boundary guardrails validated',
    );
    expect(result.errors).toEqual([]);
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

    expect(result.exitCode).toBe(1);
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

  test('workspace runner rejects raw API handler drift through Oxlint', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'verticals/catalog/api/index.ts',
      `
import { createHandler } from '@modern-js/plugin-bff/hono-server';

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
    expect(output).toContain('must not hand-build Response objects');
    expect(output).toContain('must not manually parse request bodies');
    expect(output).toContain('must not export raw request handlers');
    expect(output).toContain('must keep strictEffectApproach enabled');
  });

  test('workspace runner includes mts sources in strict API boundary checks', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'verticals/catalog/shared/api.mts',
      `
export const raw = () => new Response('legacy');
`,
    );

    const result = captureConsole(() =>
      runWorkspaceSourceCheck({
        cwd: root,
        sourceRoots: ['verticals'],
        locales: [],
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(combinedOutput(result)).toContain(
      'must not hand-build Response objects',
    );
  });

  test('workspace runner applies strict API entry checks to shell-owned APIs', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'apps/shell-super-app/api/index.ts',
      `
export const runtime = {};
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
    expect(output).toContain(
      'Generated API entries must export defineEffectBff',
    );
    expect(output).toContain('must implement handlers through HttpApiBuilder');
  });

  test('workspace runner rejects weak generic schemas in API modules', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'apps/shell-super-app/shared/api.ts',
      `
import { Schema } from '@modern-js/plugin-bff/effect-edge';

export const Payload = Schema.UnknownFromJsonString;
`,
    );

    const result = captureConsole(() =>
      runWorkspaceSourceCheck({
        cwd: root,
        sourceRoots: ['apps'],
        locales: [],
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(combinedOutput(result)).toContain('must use concrete request');
  });

  test('workspace runner rejects legacy API paths and non-HttpApi contracts', () => {
    const root = trackTempRoot();
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
        sourceRoots: ['verticals'],
        locales: [],
      }),
    );
    const output = combinedOutput(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain('api/effect, api/lambda, shared/effect');
    expect(output).toContain('must declare an HttpApi contract');
    expect(output).toContain('must declare endpoints through HttpApiEndpoint');
  });

  test('workspace runner accepts renamed locale resource identifiers and explicit resources property', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'apps/shell/src/modern.runtime.ts',
      `
import czechShell from '../locales/cs/shell.json';
import englishShell from '../locales/en/shell.json';

const localeResources = {
  cs: czechShell,
  en: englishShell,
};

export default {
  i18n: {
    initOptions: {
      resources: localeResources
    },
  },
};
`,
    );
    writeFile(
      root,
      'apps/shell/locales/en/shell.json',
      JSON.stringify({ title: 'shell' }),
    );
    writeFile(
      root,
      'apps/shell/locales/cs/shell.json',
      JSON.stringify({ title: 'shell' }),
    );

    const result = captureConsole(() =>
      runWorkspaceSourceCheck({ cwd: root, sourceRoots: ['apps'] }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.logs).toContain(
      'UltraModern i18n and boundary guardrails validated',
    );
    expect(result.errors).toEqual([]);
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

  test('workspace runner keeps runtime resource and plural-resource checks', () => {
    const root = trackTempRoot();
    writeFile(
      root,
      'apps/shell/src/modern.runtime.ts',
      `
export default {
  i18n: {
    initOptions: {},
  },
};
`,
    );
    writeFile(
      root,
      'apps/shell/locales/en/shell.json',
      JSON.stringify({
        item_one: '{{count}} item',
      }),
    );

    const result = captureConsole(() =>
      runWorkspaceSourceCheck({ cwd: root, sourceRoots: ['apps'] }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toContain(
      'must register locale JSON resources',
    );
  });
});
