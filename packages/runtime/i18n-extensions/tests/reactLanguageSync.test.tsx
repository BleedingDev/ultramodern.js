import React, { act, Suspense, startTransition } from 'react';
import { createRoot } from 'react-dom/client';
import { useLatestLanguageSync } from '../src/language-sync/react';

interface Target {
  id: string;
  language: string;
}

test('an abandoned suspended render cannot publish an uncommitted target', async () => {
  let resolveFirst!: () => void;
  const firstChange = new Promise<void>(resolve => {
    resolveFirst = resolve;
  });
  const changes: string[] = [];
  const commits: string[] = [];
  const neverSettles = new Promise<never>(() => undefined);
  const first = { id: 'first', language: 'en' };
  const speculative = { id: 'speculative', language: 'en' };

  const Harness = ({
    suspend = false,
    target,
  }: {
    suspend?: boolean;
    target: Target;
  }) => {
    useLatestLanguageSync({
      target,
      desiredLanguage: 'cs',
      readLanguage: current => current.language,
      changeLanguage: async current => {
        changes.push(current.id);
        if (current === first) {
          await firstChange;
          current.language = 'cs';
        }
      },
      commitLanguage: (current, language) => {
        commits.push(`${current.id}:${language}`);
      },
    });
    if (suspend) {
      throw neverSettles;
    }
    return <main>{target.id}</main>;
  };

  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<Harness target={first} />);
  });
  expect(changes).toEqual(['first']);

  await act(async () => {
    startTransition(() => {
      root.render(
        <Suspense fallback={<p>loading</p>}>
          <Harness suspend target={speculative} />
        </Suspense>,
      );
    });
    await Promise.resolve();
  });

  await act(async () => {
    resolveFirst();
    await firstChange;
  });

  expect(changes).toEqual(['first']);
  expect(commits).toEqual(['first:cs']);
  expect(container.textContent).toBe('first');

  await act(async () => root.unmount());
});

test('an online wakeup retries a bounded terminal failure without remounting', async () => {
  const target = { id: 'target', language: 'en' };
  const commits: string[] = [];
  const failures: string[] = [];
  let attempts = 0;
  const Harness = () => {
    useLatestLanguageSync({
      target,
      desiredLanguage: 'cs',
      policy: { maxAttempts: 1 },
      readLanguage: current => current.language,
      changeLanguage: async current => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('offline');
        }
        current.language = 'cs';
      },
      commitLanguage: (_current, language) => commits.push(language),
      reportFailure: failure => failures.push(failure.language),
    });
    return null;
  };
  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => root.render(<Harness />));
  expect(attempts).toBe(1);
  expect(failures).toEqual(['cs']);

  await act(async () => {
    window.dispatchEvent(new Event('online'));
  });
  expect(attempts).toBe(2);
  expect(commits).toEqual(['cs']);
  expect(target.language).toBe('cs');

  await act(async () => root.unmount());
});
