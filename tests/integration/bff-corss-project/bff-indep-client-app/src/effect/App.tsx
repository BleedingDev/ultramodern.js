import effectBff from 'bff-api-app/api/effect/index';
import { configure } from 'bff-api-app/runtime';
import { useEffect, useState } from 'react';
import { apiOrigin } from '../apiOrigin';

configure({
  setDomain() {
    return apiOrigin;
  },
  allowCrossOriginEnvelope: true,
});

type EffectGreetingResponse = {
  runtime: string;
  message: string;
};
type EffectTraceHeaderResponse = {
  runtime: string;
  locale?: string;
  traceparent?: string;
};
type EffectGreetingClient = {
  greetings: {
    hello: (request: Record<string, unknown>) => Promise<unknown>;
    traceHeader: (request: Record<string, unknown>) => Promise<unknown>;
  };
};

function toEffectGreetingResponse(value: unknown): EffectGreetingResponse {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid effect response');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.runtime !== 'string' ||
    typeof record.message !== 'string'
  ) {
    throw new Error('Invalid effect response');
  }
  return {
    runtime: record.runtime,
    message: record.message,
  };
}

function toEffectTraceHeaderResponse(
  value: unknown,
): EffectTraceHeaderResponse {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid effect response');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.runtime !== 'string') {
    throw new Error('Invalid effect response');
  }
  return {
    runtime: record.runtime,
    ...(typeof record.locale === 'string' ? { locale: record.locale } : {}),
    ...(typeof record.traceparent === 'string'
      ? { traceparent: record.traceparent }
      : {}),
  };
}

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

const App = () => {
  const [message, setMessage] = useState('loading');
  const [contextMessage, setContextMessage] = useState('loading');

  useEffect(() => {
    const effectModule = effectBff as unknown as {
      client: EffectGreetingClient;
      createEffectRequestContext?: (
        requestContext: Record<string, unknown>,
      ) => Record<string, unknown>;
    };
    const effectGreetingClient = effectModule.client;
    effectGreetingClient.greetings
      .hello({})
      .then(toEffectGreetingResponse)
      .then((data: EffectGreetingResponse) => {
        setMessage(`${data.runtime}:${data.message}`);
      });
    effectGreetingClient.greetings
      .traceHeader({
        requestContext: effectModule.createEffectRequestContext?.({
          locale: 'cs-CZ',
          traceparent: TRACEPARENT,
        }),
      })
      .then(toEffectTraceHeaderResponse)
      .then((data: EffectTraceHeaderResponse) => {
        setContextMessage(
          `${data.runtime}:${data.locale ?? 'missing'}:${data.traceparent ?? 'missing'}`,
        );
      });
  }, []);

  return (
    <>
      <div className="effect">{message}</div>
      <div className="effect-context">{contextMessage}</div>
    </>
  );
};

export default App;
