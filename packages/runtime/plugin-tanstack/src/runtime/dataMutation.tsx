// @effect-diagnostics asyncFunction:off extendsNativeError:off strictBooleanExpressions:off
import { useRouter } from '@tanstack/react-router';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import type { SubmitOptions, SubmitTarget } from './formData';
import {
  createFormDataFromSubmit,
  getSubmitter,
  resolveSubmitOptionsFromForm,
} from './formData';
import { submitRouteAction } from './submitAction';

export type { SubmitOptions } from './formData';
export { RouteActionResponseError } from './submitAction';

export type FetcherState = 'idle' | 'submitting' | 'loading';

export type FormProps = Omit<
  React.FormHTMLAttributes<HTMLFormElement>,
  'onSubmit' | 'action'
> & {
  action?: string;
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  reloadDocument?: boolean;
};

export function Form({
  action,
  method = 'get',
  encType,
  reloadDocument,
  onSubmit,
  ...rest
}: FormProps) {
  const router = useRouter();

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      onSubmit?.(event);
      if (event.defaultPrevented || reloadDocument) {
        return;
      }

      event.preventDefault();
      const submitter = getSubmitter(event);
      const formData = createFormDataFromSubmit({
        form: event.currentTarget,
        submitter,
      });
      const normalizedOptions = resolveSubmitOptionsFromForm({
        form: event.currentTarget,
        submitter,
        action,
        method,
        encType,
      });
      await submitRouteAction({
        router,
        target: formData,
        options: normalizedOptions,
      });
    },
    [action, encType, method, onSubmit, reloadDocument, router],
  );

  return (
    <form
      {...rest}
      action={action}
      method={method}
      encType={encType}
      onSubmit={handleSubmit}
    />
  );
}

export type FetcherSubmitOptions = SubmitOptions;

export type Fetcher = {
  state: FetcherState;
  data: unknown;
  error: unknown;
  Form: React.ComponentType<FormProps>;
  submit: (
    target: SubmitTarget,
    options?: FetcherSubmitOptions,
  ) => Promise<void>;
};

export function useFetcher(): Fetcher {
  const router = useRouter();
  const [state, setState] = useState<FetcherState>('idle');
  const [data, setData] = useState<unknown>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const requestStatesRef = useRef<Map<number, Exclude<FetcherState, 'idle'>>>(
    new Map(),
  );
  const requestIdRef = useRef(0);

  const syncStateFromRequests = useCallback(() => {
    let hasSubmitting = false;
    let hasLoading = false;

    requestStatesRef.current.forEach(requestState => {
      if (requestState === 'submitting') {
        hasSubmitting = true;
      } else if (requestState === 'loading') {
        hasLoading = true;
      }
    });

    if (hasSubmitting) {
      setState('submitting');
      return;
    }
    if (hasLoading) {
      setState('loading');
      return;
    }
    setState('idle');
  }, []);

  const setRequestState = useCallback(
    (requestId: number, requestState: Exclude<FetcherState, 'idle'>) => {
      requestStatesRef.current.set(requestId, requestState);
      syncStateFromRequests();
    },
    [syncStateFromRequests],
  );

  const clearRequestState = useCallback(
    (requestId: number) => {
      requestStatesRef.current.delete(requestId);
      syncStateFromRequests();
    },
    [syncStateFromRequests],
  );

  const submit = useCallback(
    async (target: SubmitTarget, options?: FetcherSubmitOptions) => {
      setError(undefined);
      const requestId = ++requestIdRef.current;
      const normalizedMethod = (options?.method || 'post').toLowerCase();
      const isLoaderSubmit = normalizedMethod === 'get';
      setRequestState(requestId, isLoaderSubmit ? 'loading' : 'submitting');

      try {
        const result = await submitRouteAction({
          router,
          target,
          options,
          isFetcher: true,
          onInvalidateStart: () => {
            if (!isLoaderSubmit) {
              setRequestState(requestId, 'loading');
            }
          },
        });
        setData(result);
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        clearRequestState(requestId);
      }
    },
    [clearRequestState, router, setRequestState],
  );

  const FetcherForm = useCallback(
    ({
      action,
      method = 'get',
      encType,
      reloadDocument,
      onSubmit,
      ...rest
    }: FormProps) => {
      const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        onSubmit?.(event);
        if (event.defaultPrevented || reloadDocument) {
          return;
        }

        event.preventDefault();
        const submitter = getSubmitter(event);
        const formData = createFormDataFromSubmit({
          form: event.currentTarget,
          submitter,
        });
        const normalizedOptions = resolveSubmitOptionsFromForm({
          form: event.currentTarget,
          submitter,
          action,
          method,
          encType,
        });
        await submit(formData, normalizedOptions);
      };

      return (
        <form
          {...rest}
          action={action}
          method={method}
          encType={encType}
          onSubmit={handleSubmit}
        />
      );
    },
    [submit],
  );

  return {
    state,
    data,
    error,
    Form: FetcherForm,
    submit,
  };
}
