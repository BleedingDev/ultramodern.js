import effectBff from 'bff-api-app/api/effect/index';
import { configure } from 'bff-api-app/runtime';
import { useEffect, useState } from 'react';

configure({
  setDomain() {
    return 'http://127.0.0.1:3399';
  },
});

type EffectGreetingResponse = {
  runtime: string;
  message: string;
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

const App = () => {
  const [message, setMessage] = useState('loading');

  useEffect(() => {
    effectBff.client.greetings
      .hello({})
      .then(toEffectGreetingResponse)
      .then((data: EffectGreetingResponse) => {
        setMessage(`${data.runtime}:${data.message}`);
      });
  }, []);

  return <div className="effect">{message}</div>;
};

export default App;
