// @effect-diagnostics asyncFunction:off globalFetch:off
import effectBff from '@api/effect/index';
import { configure } from '@modern-js/plugin-bff/client';
import { useEffect, useState } from 'react';

configure({
  request: async (input, init) => {
    const response = await fetch(input, init);
    const data = (await response.json()) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        ...data,
        message: 'Hello Effect Custom SDK',
      }),
      {
        status: response.status,
        headers: response.headers,
      },
    );
  },
});

export default function CustomSdkPage() {
  const [message, setMessage] = useState('pending');

  useEffect(() => {
    effectBff.client.greetings.hello({}).then(data => {
      const maybeResponse = data as unknown;
      if (maybeResponse instanceof Response) {
        maybeResponse
          .json()
          .then((payload: { message?: string }) => {
            setMessage(payload.message ?? 'unknown');
          })
          .catch(() => {
            setMessage('unknown');
          });
        return;
      }
      setMessage(data.message);
    });
  }, []);

  return <div className="custom-sdk-message">{message}</div>;
}
