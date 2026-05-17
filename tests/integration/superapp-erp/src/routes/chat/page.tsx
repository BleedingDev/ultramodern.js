// @effect-diagnostics asyncFunction:off
import effectBff from '@api/effect/index';
import { useMatch } from '@modern-js/plugin-tanstack/runtime';
import { useEffect, useState } from 'react';
import type { ChatMessage } from '../../../shared/superapp-state.js';

type BootstrapData = Awaited<ReturnType<typeof effectBff.client.erp.bootstrap>>;

export default function ChatPage() {
  const match = useMatch({ from: '/chat' });
  const [data, setData] = useState<BootstrapData | null>(null);
  const [text, setText] = useState('Need capacity reroute approval');
  const [receipt, setReceipt] = useState('none');

  const refresh = () => effectBff.client.erp.bootstrap({}).then(setData);

  useEffect(() => {
    refresh();
  }, []);

  const send = async () => {
    const result = await effectBff.client.erp.sendChat({
      payload: {
        channel: 'incident-war-room',
        author: 'ops.commander',
        text,
        priority: 'urgent',
      },
    });
    setReceipt(`${result.message.id}:${result.totalMessages}`);
    await refresh();
  };

  return (
    <section className="panel" data-testid="chat-page">
      <h1>Operations Chat</h1>
      <div data-testid="route-kind">{match.loaderData!.routeKind}</div>
      <div className="actions">
        <input
          data-testid="chat-input"
          value={text}
          onChange={event => setText(event.currentTarget.value)}
        />
        <button
          type="button"
          data-testid="chat-send"
          onClick={() => void send()}
        >
          Send
        </button>
      </div>
      <div data-testid="chat-receipt">{receipt}</div>
      <div data-testid="chat-list">
        {(data?.chat as ChatMessage[] | undefined)?.map(message => (
          <div
            className="message"
            data-testid={`chat-${message.id}`}
            key={message.id}
          >
            {message.author}:{message.priority}:{message.text}
          </div>
        ))}
      </div>
    </section>
  );
}
