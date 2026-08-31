import {
  createLatestLanguageSyncBinding,
  type LanguageSyncFailure,
} from '../src/language-sync/controller';

interface Target {
  language: string;
}

interface PendingChange {
  language: string;
  promise: Promise<void>;
  reject: (error: Error) => void;
  resolve: () => void;
}

const deferredChanger = (target: Target) => {
  const pending: PendingChange[] = [];
  const changeLanguage = (_target: Target, language: string) => {
    let resolvePromise!: () => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    pending.push({
      language,
      promise,
      reject: rejectPromise,
      resolve: () => {
        target.language = language;
        resolvePromise();
      },
    });
    return promise;
  };
  return { changeLanguage, pending };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('latest language synchronization coordinator', () => {
  afterEach(() => {
    rstest.useRealTimers();
    rstest.restoreAllMocks();
  });

  test('retains a request issued before commit-phase activation', async () => {
    const target = { language: 'en' };
    const changeLanguage = rstest.fn(async () => undefined);
    const binding = createLatestLanguageSyncBinding<Target>();
    binding.updateCallbacks({
      changeLanguage,
      commitLanguage: () => undefined,
      readLanguage: current => current.language,
    });

    binding.request('cs');
    expect(changeLanguage).not.toHaveBeenCalled();
    binding.activate(target);
    expect(changeLanguage).toHaveBeenCalledWith(target, 'cs');
    await flush();
    binding.deactivate();
  });

  test('starts newer work immediately and repairs a late stale mutation', async () => {
    const target = { language: 'en' };
    const { changeLanguage, pending } = deferredChanger(target);
    const commits: string[] = [];
    const binding = createLatestLanguageSyncBinding<Target>();
    binding.updateCallbacks({
      changeLanguage,
      commitLanguage: (_target, language) => commits.push(language),
      readLanguage: current => current.language,
    });
    binding.activate(target);

    binding.request('cs');
    binding.request('de');
    expect(pending.map(change => change.language)).toEqual(['cs', 'de']);

    pending[1].resolve();
    await pending[1].promise;
    await flush();
    expect(commits).toEqual(['de']);

    pending[0].resolve();
    await pending[0].promise;
    await flush();
    expect(target.language).toBe('cs');
    expect(pending.map(change => change.language)).toEqual(['cs', 'de', 'de']);

    pending[2].resolve();
    await pending[2].promise;
    await flush();
    expect(target.language).toBe('de');
    expect(commits.at(-1)).toBe('de');
  });

  test('repairs a shared singleton after the starting mount leaves', async () => {
    const target = { language: 'en' };
    const { changeLanguage, pending } = deferredChanger(target);
    const commits: string[] = [];
    const first = createLatestLanguageSyncBinding<Target>();
    const second = createLatestLanguageSyncBinding<Target>();
    for (const binding of [first, second]) {
      binding.updateCallbacks({
        changeLanguage,
        commitLanguage: (_target, language) => commits.push(language),
        readLanguage: current => current.language,
      });
    }

    first.activate(target);
    first.request('cs');
    first.deactivate();
    second.activate(target);
    second.request('de');

    pending[1].resolve();
    await pending[1].promise;
    await flush();
    pending[0].resolve();
    await pending[0].promise;
    await flush();

    expect(pending.map(change => change.language)).toEqual(['cs', 'de', 'de']);
    pending[2].resolve();
    await pending[2].promise;
    await flush();
    expect(target.language).toBe('de');
    expect(commits.at(-1)).toBe('de');
  });

  test('supersedes a hung same-language attempt and repairs it after a later route', async () => {
    rstest.useFakeTimers();
    const target = { language: 'en' };
    const { changeLanguage, pending } = deferredChanger(target);
    const commits: string[] = [];
    const binding = createLatestLanguageSyncBinding<Target>({
      attemptTimeoutMs: 100,
      retryDelayMs: () => 10,
    });
    binding.updateCallbacks({
      changeLanguage,
      commitLanguage: (_target, language) => commits.push(language),
      readLanguage: current => current.language,
    });
    binding.activate(target);
    binding.request('cs');

    await rstest.advanceTimersByTimeAsync(110);
    expect(pending.map(change => change.language)).toEqual(['cs', 'cs']);
    pending[1].resolve();
    await pending[1].promise;
    await flush();
    expect(commits.at(-1)).toBe('cs');

    binding.request('de');
    pending[2].resolve();
    await pending[2].promise;
    await flush();
    expect(target.language).toBe('de');

    pending[0].resolve();
    await pending[0].promise;
    await flush();
    expect(pending.at(-1)?.language).toBe('de');
    pending.at(-1)?.resolve();
    await pending.at(-1)?.promise;
    await flush();
    expect(target.language).toBe('de');
  });

  test('bounds permanent failures and reports the final consequence once', async () => {
    rstest.useFakeTimers();
    const target = { language: 'en' };
    const failures: LanguageSyncFailure[] = [];
    const changeLanguage = rstest.fn(async () => {
      throw new Error('resources unavailable');
    });
    const binding = createLatestLanguageSyncBinding<Target>({
      attemptTimeoutMs: 1_000,
      maxAttempts: 3,
      retryDelayMs: () => 10,
    });
    binding.updateCallbacks({
      changeLanguage,
      commitLanguage: () => undefined,
      readLanguage: current => current.language,
      reportFailure: failure => failures.push(failure),
    });
    binding.activate(target);
    binding.request('cs');

    await flush();
    await rstest.advanceTimersByTimeAsync(10);
    await flush();
    await rstest.advanceTimersByTimeAsync(10);
    await flush();

    expect(changeLanguage).toHaveBeenCalledTimes(3);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      attempts: 3,
      language: 'cs',
      reason: 'rejected',
    });
  });
});
