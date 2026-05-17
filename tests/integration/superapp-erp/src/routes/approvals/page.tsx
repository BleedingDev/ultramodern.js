// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
import effectBff from '@api/effect/index';
import { useMatch } from '@modern-js/plugin-tanstack/runtime';
import { useEffect, useState } from 'react';
import type { Approval } from '../../../shared/superapp-state.js';

type BootstrapData = Awaited<ReturnType<typeof effectBff.client.erp.bootstrap>>;

export default function ApprovalsPage() {
  const match = useMatch({ from: '/approvals' });
  const [data, setData] = useState<BootstrapData | null>(null);
  const [decision, setDecision] = useState('none');

  const refresh = () => effectBff.client.erp.bootstrap({}).then(setData);

  useEffect(() => {
    refresh();
  }, []);

  const approveFirst = async () => {
    const firstPending = (data?.approvals as Approval[] | undefined)?.find(
      item => item.status === 'pending',
    );
    if (!firstPending) {
      return;
    }
    const result = await effectBff.client.erp.decideApproval({
      params: {
        id: firstPending.id,
      },
      payload: {
        decision: 'approved',
        actor: 'finance.lead',
      },
    });
    setDecision(`${result.id}:${result.status}:${result.pendingApprovals}`);
    await refresh();
  };

  return (
    <section className="panel" data-testid="approvals-page">
      <h1>Approvals</h1>
      <div data-testid="route-kind">{match.loaderData!.routeKind}</div>
      <button
        type="button"
        data-testid="approve-first"
        onClick={() => void approveFirst()}
      >
        Approve first pending
      </button>
      <div data-testid="approval-decision">{decision}</div>
      <div data-testid="approval-list">
        {(data?.approvals as Approval[] | undefined)?.map(item => (
          <div
            className="approval"
            data-testid={`approval-${item.id}`}
            key={item.id}
          >
            {item.id}:{item.status}:{item.amount}
          </div>
        ))}
      </div>
    </section>
  );
}
