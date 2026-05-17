// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off
import effectBff from '@api/effect/index';
import {
  makeEffectRpcClient,
  runEffectRequest,
  runEffectView,
  view,
} from '@modern-js/plugin-bff/effect-client';
import { useEffect, useState } from 'react';
import { bffRpcGroup } from '../../shared/effect-rpc.js';

const userCardView = view<{
  id: string;
  source: string;
}>()({
  id: true,
});

export default function Page() {
  const [effectMessage, setEffectMessage] = useState('pending');
  const [userMessage, setUserMessage] = useState('pending');
  const [projectionMessage, setProjectionMessage] = useState('pending');
  const [echoMessage, setEchoMessage] = useState('pending');
  const [rpcMessage, setRpcMessage] = useState('pending');

  useEffect(() => {
    effectBff.client.greetings.hello({}).then(data => {
      setEffectMessage(data.message);
    });

    const userByIdRequest = effectBff.client.greetings.userById({
      params: { id: '42' },
      query: { source: 'browser' },
    });

    userByIdRequest.then(data => {
      setUserMessage(`${data.id}:${data.source}`);
    });

    runEffectView(userByIdRequest, userCardView).then(data => {
      setProjectionMessage(data.id);
    });

    effectBff.client.greetings
      .echo({
        payload: { text: 'echo-from-client' },
      })
      .then(data => {
        setEchoMessage(data.echoed);
      });

    runEffectRequest(
      makeEffectRpcClient(bffRpcGroup, {
        url: `${window.location.origin}/bff-api/rpc`,
      }),
    )
      .then(async client => {
        try {
          return await runEffectRequest(
            client.ping({
              name: 'browser',
            }),
          );
        } finally {
          await client.dispose();
        }
      })
      .then(data => {
        setRpcMessage(data.message);
      });
  }, []);

  return (
    <div>
      <div className="effect-message">{effectMessage}</div>
      <div className="user-message">{userMessage}</div>
      <div className="projection-message">{projectionMessage}</div>
      <div className="echo-message">{echoMessage}</div>
      <div className="rpc-message">{rpcMessage}</div>
    </div>
  );
}
