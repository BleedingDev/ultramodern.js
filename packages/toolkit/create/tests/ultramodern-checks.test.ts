import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  oxlintPlugin,
  runSingleAppI18nCheck,
  runWorkspaceSourceCheck,
} from '../src/ultramodern-checks';

type CapturedConsole = {
  readonly exitCode: number;
  readonly errors: readonly string[];
  readonly logs: readonly string[];
};

const createTempRoot = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-checks-test-'));

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

describe('@modern-js/create/ultramodern-checks', () => {
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
      <code>pnpm dev</code>
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
