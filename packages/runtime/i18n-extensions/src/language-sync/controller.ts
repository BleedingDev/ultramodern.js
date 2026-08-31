export type LanguageSyncFailureReason = 'rejected' | 'timeout';

export interface LanguageSyncFailure {
  attempts: number;
  error: unknown;
  language: string;
  reason: LanguageSyncFailureReason;
}

export interface LanguageSyncPolicy {
  attemptTimeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: (failedAttempts: number) => number;
}

export interface LanguageSyncCallbacks<TTarget extends object> {
  changeLanguage: (
    target: TTarget,
    language: string,
  ) => PromiseLike<unknown> | unknown;
  commitLanguage: (target: TTarget, language: string) => void;
  readLanguage?: (target: TTarget) => string | undefined;
  reportFailure?: (failure: LanguageSyncFailure) => void;
}

export interface LatestLanguageSyncBinding<TTarget extends object> {
  activate(target: TTarget): void;
  clearRequest(): void;
  deactivate(): void;
  request(language: string): void;
  updateCallbacks(callbacks: LanguageSyncCallbacks<TTarget>): void;
}

const DEFAULT_ATTEMPT_TIMEOUT_MS = 1_000;
const DEFAULT_MAX_ATTEMPTS = 4;

const defaultRetryDelay = (failedAttempts: number) =>
  Math.min(50 * 2 ** Math.max(failedAttempts - 1, 0), 1_000);

const normalizePolicy = (policy: LanguageSyncPolicy) => ({
  attemptTimeoutMs: Math.max(
    1,
    policy.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS,
  ),
  maxAttempts: Math.max(1, policy.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
  retryDelayMs: policy.retryDelayMs ?? defaultRetryDelay,
});

class LanguageSyncTimeoutError extends Error {
  constructor(language: string, timeoutMs: number) {
    super(
      `Language synchronization for "${language}" did not settle within ${timeoutMs}ms.`,
    );
    this.name = 'LanguageSyncTimeoutError';
  }
}

interface ActiveIntent {
  attempts: number;
  generation: number;
  language: string;
  status: 'attempting' | 'failed' | 'retry-wait' | 'satisfied';
}

interface Attempt {
  generation: number;
  language: string;
  settled: boolean;
  timedOut: boolean;
  timer: ReturnType<typeof setTimeout>;
}

let requestOrder = 0;

class Binding<TTarget extends object> {
  callbacks: LanguageSyncCallbacks<TTarget> | undefined;
  coordinator: Coordinator<TTarget> | undefined;
  desiredLanguage: string | undefined;
  order = 0;
  target: TTarget | undefined;

  constructor(readonly policy: ReturnType<typeof normalizePolicy>) {}

  activate(target: TTarget) {
    if (this.target === target && this.coordinator) {
      return;
    }
    const desiredLanguage = this.desiredLanguage;
    const order = this.order;
    this.deactivate();
    this.desiredLanguage = desiredLanguage;
    this.order = order;
    this.target = target;
    this.coordinator = getCoordinator(target, this.policy);
    this.coordinator.add(this);
    this.coordinator.refresh();
  }

  clearRequest() {
    if (!this.desiredLanguage) {
      return;
    }
    this.desiredLanguage = undefined;
    this.order = ++requestOrder;
    this.coordinator?.refresh();
  }

  deactivate() {
    const coordinator = this.coordinator;
    this.coordinator = undefined;
    this.target = undefined;
    this.desiredLanguage = undefined;
    coordinator?.remove(this);
  }

  request(language: string) {
    const normalizedLanguage = language.trim();
    if (!normalizedLanguage) {
      return;
    }
    const repeatedFailedRequest =
      this.desiredLanguage === normalizedLanguage &&
      this.coordinator?.isFailed(normalizedLanguage);
    this.desiredLanguage = normalizedLanguage;
    this.order = ++requestOrder;
    this.coordinator?.refresh(repeatedFailedRequest);
  }

  updateCallbacks(callbacks: LanguageSyncCallbacks<TTarget>) {
    this.callbacks = callbacks;
  }
}

class Coordinator<TTarget extends object> {
  private readonly bindings = new Set<Binding<TTarget>>();
  private generation = 0;
  private intent: ActiveIntent | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly target: TTarget,
    private readonly policy: ReturnType<typeof normalizePolicy>,
  ) {}

  add(binding: Binding<TTarget>) {
    this.bindings.add(binding);
  }

  isFailed(language: string) {
    return (
      this.intent?.language === language && this.intent.status === 'failed'
    );
  }

  refresh(forceRetry = false) {
    const selected = this.selectBinding();
    if (!selected?.desiredLanguage) {
      this.invalidateIntent();
      return;
    }

    const language = selected.desiredLanguage;
    if (this.intent?.language === language && !forceRetry) {
      if (this.intent.status === 'satisfied') {
        this.commit(language);
      }
      return;
    }

    this.beginIntent(language, false);
  }

  remove(binding: Binding<TTarget>) {
    this.bindings.delete(binding);
    this.refresh();
  }

  private beginIntent(language: string, forceChange: boolean) {
    this.clearRetry();
    const intent: ActiveIntent = {
      attempts: 0,
      generation: ++this.generation,
      language,
      status: 'attempting',
    };
    this.intent = intent;

    const activeBinding = this.selectBinding();
    if (
      !forceChange &&
      activeBinding?.callbacks?.readLanguage?.(this.target) === language
    ) {
      intent.status = 'satisfied';
      this.commit(language);
      return;
    }

    this.startAttempt(intent);
  }

  private clearRetry() {
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private commit(language: string) {
    for (const binding of this.bindings) {
      if (binding.callbacks) {
        binding.callbacks.commitLanguage(this.target, language);
      }
    }
  }

  private failAttempt(
    intent: ActiveIntent,
    reason: LanguageSyncFailureReason,
    error: unknown,
  ) {
    if (this.intent !== intent || intent.status === 'satisfied') {
      return;
    }

    if (intent.attempts >= this.policy.maxAttempts) {
      intent.status = 'failed';
      for (const binding of this.bindings) {
        if (binding.desiredLanguage === intent.language) {
          binding.callbacks?.reportFailure?.({
            attempts: intent.attempts,
            error,
            language: intent.language,
            reason,
          });
        }
      }
      return;
    }

    intent.status = 'retry-wait';
    const retryDelay = Math.max(0, this.policy.retryDelayMs(intent.attempts));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.intent === intent && this.selectBinding()?.desiredLanguage) {
        intent.status = 'attempting';
        this.startAttempt(intent);
      }
    }, retryDelay);
  }

  private invalidateIntent() {
    this.clearRetry();
    this.generation += 1;
    this.intent = undefined;
  }

  private onFulfilled(attempt: Attempt) {
    if (attempt.settled) {
      return;
    }
    attempt.settled = true;
    clearTimeout(attempt.timer);

    const intent = this.intent;
    if (!intent) {
      return;
    }

    if (attempt.language === intent.language) {
      this.clearRetry();
      if (intent.status !== 'satisfied') {
        intent.status = 'satisfied';
        this.commit(intent.language);
      }
      return;
    }

    // A superseded operation may mutate a shared i18n singleton when it
    // eventually settles. Reassert the committed intent through the newest
    // mounted binding, even when the binding that started the stale work left.
    this.beginIntent(intent.language, true);
  }

  private onRejected(attempt: Attempt, error: unknown) {
    if (attempt.settled) {
      return;
    }
    attempt.settled = true;
    clearTimeout(attempt.timer);
    if (attempt.timedOut) {
      return;
    }

    const intent = this.intent;
    if (
      intent?.generation === attempt.generation &&
      intent.language === attempt.language
    ) {
      this.failAttempt(intent, 'rejected', error);
    }
  }

  private selectBinding() {
    let selected: Binding<TTarget> | undefined;
    for (const binding of this.bindings) {
      if (
        binding.desiredLanguage &&
        binding.callbacks &&
        (!selected || binding.order > selected.order)
      ) {
        selected = binding;
      }
    }
    return selected;
  }

  private startAttempt(intent: ActiveIntent) {
    const binding = this.selectBinding();
    const callbacks = binding?.callbacks;
    if (!callbacks || binding?.desiredLanguage !== intent.language) {
      this.refresh();
      return;
    }

    intent.attempts += 1;
    const attempt: Attempt = {
      generation: intent.generation,
      language: intent.language,
      settled: false,
      timedOut: false,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
    };
    attempt.timer = setTimeout(() => {
      if (attempt.settled || attempt.timedOut) {
        return;
      }
      attempt.timedOut = true;
      if (
        this.intent === intent &&
        intent.generation === attempt.generation &&
        intent.language === attempt.language
      ) {
        this.failAttempt(
          intent,
          'timeout',
          new LanguageSyncTimeoutError(
            attempt.language,
            this.policy.attemptTimeoutMs,
          ),
        );
      }
    }, this.policy.attemptTimeoutMs);

    let result: PromiseLike<unknown> | unknown;
    try {
      result = callbacks.changeLanguage(this.target, intent.language);
    } catch (error) {
      this.onRejected(attempt, error);
      return;
    }

    Promise.resolve(result).then(
      () => this.onFulfilled(attempt),
      error => this.onRejected(attempt, error),
    );
  }
}

const coordinators = new WeakMap<object, Coordinator<any>>();

const getCoordinator = <TTarget extends object>(
  target: TTarget,
  policy: ReturnType<typeof normalizePolicy>,
): Coordinator<TTarget> => {
  const existing = coordinators.get(target);
  if (existing) {
    return existing;
  }
  const coordinator = new Coordinator(target, policy);
  coordinators.set(target, coordinator);
  return coordinator;
};

export const createLatestLanguageSyncBinding = <TTarget extends object>(
  policy: LanguageSyncPolicy = {},
): LatestLanguageSyncBinding<TTarget> => new Binding(normalizePolicy(policy));
