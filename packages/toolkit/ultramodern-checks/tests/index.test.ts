import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSingleAppI18nCheck, runWorkspaceSourceCheck } from '../src';

const tempRoots: string[] = [];

const createTempRoot = (name: string) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  tempRoots.push(root);
  return root;
};

const writeText = (root: string, relativePath: string, content: string) => {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
};

afterAll(() => {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('UltraModern shared checks', () => {
  test('allows localized JSX and ignores TypeScript generic syntax', () => {
    const root = createTempRoot('ultramodern-i18n-pass');
    writeText(
      root,
      'src/app.tsx',
      `
import { Data, Effect } from 'effect';

class WorkflowClientError extends Data.TaggedError('WorkflowClientError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

type AppEffect<A> = Effect.Effect<A, WorkflowClientError>;

const promiseEffect = <A,>(
  evaluate: () => PromiseLike<A>,
  message = 'Client operation failed.',
): AppEffect<A> =>
  Effect.promise(evaluate).pipe(
    Effect.mapError((cause) => new WorkflowClientError({ cause, message })),
  );

const silentEffect = <A,>(effect: AppEffect<A>): Effect.Effect<A | undefined> =>
  effect.pipe(Effect.orElseSucceed((): undefined => undefined));

const workflowSnapshotFromResponseEffect = (response: Response) =>
  promiseEffect(
    () => response.json() as Promise<unknown>,
    'Workflow response was not valid JSON.',
  );

export const App = ({ draft, t }: { draft: { title: string }; t: (key: string) => string }) => (
  <main>
    <input placeholder={t('coursition.app.knowledge.urlPlaceholder')} />
    <p>{draft.title}</p>
    <code>pnpm typecheck</code>
    <kbd>Command K</kbd>
    {/* i18n-ignore: product token */}
    <p>UltraModern.js</p>
  </main>
);
`,
    );

    expect(runSingleAppI18nCheck({ cwd: root })).toBe(0);
  });

  test('rejects hardcoded visible JSX text and literal visible attributes', () => {
    const root = createTempRoot('ultramodern-i18n-fail');
    writeText(
      root,
      'src/app.tsx',
      `
export const App = () => (
  <main>
    <h1>Course preparation</h1>
    <input aria-label={'Close dialog'} placeholder="Paste the source URL." />
  </main>
);
`,
    );

    expect(runSingleAppI18nCheck({ cwd: root })).not.toBe(0);
  });

  test('allows clean workspace source when configured with visible attribute options', () => {
    const root = createTempRoot('ultramodern-workspace-source-pass');
    writeText(
      root,
      'apps/demo/src/app.tsx',
      `
export const App = () => <div data-modern-boundary-id="demo" data-modern-mf-expose="./App" />;
`,
    );

    expect(runWorkspaceSourceCheck({ cwd: root })).toBe(0);
  });

  test('rejects workspace source guardrail violations through Oxlint rules', () => {
    const root = createTempRoot('ultramodern-workspace-source-fail');
    writeText(
      root,
      'apps/demo/src/app.tsx',
      `
const copy = language === 'cs' ? 'Ahoj' : 'Hello';
const heading = t('demo.heading.prefix');

export const App = () => (
  <div data-mf-remote="demo" label="Workspace label">
    {copy}
    {heading}
  </div>
);
`,
    );

    expect(runWorkspaceSourceCheck({ cwd: root })).not.toBe(0);
  });

  test('rejects legacy Module Federation boundary ids without other marker violations', () => {
    const root = createTempRoot('ultramodern-workspace-source-boundary-fail');
    writeText(
      root,
      'apps/demo/src/app.tsx',
      `
export const App = () => <div data-mf-boundary="demo" />;
`,
    );

    expect(runWorkspaceSourceCheck({ cwd: root })).not.toBe(0);
  });

  test('keeps workspace plural-resource validation in the shared CLI', () => {
    const root = createTempRoot('ultramodern-workspace-plural-fail');
    writeText(
      root,
      'apps/demo/locales/en/demo.json',
      JSON.stringify({ files: '{{count}} files' }),
    );

    expect(runWorkspaceSourceCheck({ cwd: root })).not.toBe(0);
  });

  test('keeps workspace runtime-resource validation in the shared CLI', () => {
    const root = createTempRoot('ultramodern-workspace-runtime-fail');
    writeText(
      root,
      'apps/demo/src/modern.runtime.ts',
      'export default { i18n: { initOptions: {} } };',
    );

    expect(runWorkspaceSourceCheck({ cwd: root })).not.toBe(0);
  });
});
