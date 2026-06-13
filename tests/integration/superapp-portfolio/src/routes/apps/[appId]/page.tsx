// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
import effectBff from '@api/effect/index';
import { useMatch } from '@modern-js/plugin-tanstack/runtime';
import { useEffect, useState } from 'react';
import type {
  PortfolioApp,
  PortfolioErpState,
} from '../../../../shared/portfolio-state';

type BootstrapData = Awaited<
  ReturnType<typeof effectBff.client.portfolio.bootstrap>
>;
type ErpData = Awaited<
  ReturnType<typeof effectBff.client.portfolio.erpBootstrap>
>;

export default function PortfolioAppPage() {
  const match = useMatch({ from: '/apps/$appId' });
  const loaderData = match.loaderData!;
  const [app, setApp] = useState<PortfolioApp | null>(null);
  const [erp, setErp] = useState<ErpData | null>(null);
  const [eventId, setEventId] = useState('pending');
  const [approvalStatus, setApprovalStatus] = useState('pending');
  const [chatReceipt, setChatReceipt] = useState('pending');

  useEffect(() => {
    effectBff.client.portfolio.bootstrap({}).then((data: BootstrapData) => {
      setApp(
        ((data.apps as PortfolioApp[]).find(
          item => item.id === loaderData.appId,
        ) as PortfolioApp | undefined) ?? null,
      );
    });

    if (loaderData.appId === 'enterprise-mega-erp') {
      effectBff.client.portfolio
        .erpBootstrap({})
        .then((data: ErpData) => setErp(data));
    } else {
      setErp(null);
    }
  }, [loaderData.appId]);

  const runWorkflow = async () => {
    if (!loaderData.appId) {
      setEventId('unknown-app');
      return;
    }

    const result = await effectBff.client.portfolio.runWorkflow({
      params: {
        appId: loaderData.appId,
      },
      payload: {
        action: app?.profiles.smoke.workflows[0] ?? 'smoke',
        actor: 'browser.operator',
        requestId: `ui-${loaderData.appId}`,
      },
    });
    setEventId(`${result.event.id}:${result.event.status}`);
  };

  const approveFirst = async () => {
    const result = await effectBff.client.portfolio.decideErpApproval({
      params: {
        id: 'ap-1001',
      },
      payload: {
        decision: 'approved',
        actor: 'browser.operator',
      },
    });
    const next = await effectBff.client.portfolio.erpBootstrap({});
    setApprovalStatus(
      `${result.id}:${result.status}:${result.pendingApprovals}`,
    );
    setErp(next);
  };

  const sendChat = async () => {
    const result = await effectBff.client.portfolio.sendErpChat({
      payload: {
        channel: 'incident-war-room',
        author: 'ops.commander',
        text: 'Reroute high priority loads',
        priority: 'urgent',
      },
    });
    const next = await effectBff.client.portfolio.erpBootstrap({});
    setChatReceipt(`${result.message.id}:${result.totalMessages}`);
    setErp(next);
  };

  const erpState = erp as PortfolioErpState | null;

  return (
    <section className="panel" data-testid="portfolio-app-page">
      <h1>{app?.label ?? loaderData.appId}</h1>
      <div data-testid="app-route-kind">{loaderData.routeKind}</div>
      <div data-testid="app-capabilities">
        capabilities:{loaderData.expectedCapabilities}
      </div>
      <div data-testid="app-profiles">
        smoke:{app?.profiles.smoke.workflows.length ?? 0};stress:
        {app?.profiles.stress.workflows.length ?? 0};nightly:
        {app?.profiles.nightly.workflows.length ?? 0}
      </div>
      <button type="button" data-testid="run-workflow" onClick={runWorkflow}>
        Run workflow
      </button>
      <div data-testid="workflow-event">{eventId}</div>
      {loaderData.appId === 'enterprise-mega-erp' ? (
        <section className="erp-panel" data-testid="mega-erp-panel">
          <div data-testid="erp-summary">
            tenant:{erp?.summary.tenantName ?? 'loading'};modules:
            {erp?.summary.moduleCount ?? 0};pending:
            {erp?.summary.pendingApprovals ?? 0};urgent:
            {erp?.summary.urgentMessages ?? 0}
          </div>
          <button
            type="button"
            data-testid="approve-first"
            onClick={approveFirst}
          >
            Approve first
          </button>
          <div data-testid="approval-decision">{approvalStatus}</div>
          <div data-testid="approval-ap-1001">
            ap-1001:
            {erpState?.approvals.find(approval => approval.id === 'ap-1001')
              ?.status ?? 'pending'}
          </div>
          <button type="button" data-testid="chat-send" onClick={sendChat}>
            Send chat
          </button>
          <div data-testid="chat-receipt">{chatReceipt}</div>
          {erpState?.chat.map(message => (
            <div key={message.id} data-testid={`chat-${message.id}`}>
              {message.author}:{message.priority}:{message.text}
            </div>
          ))}
        </section>
      ) : null}
    </section>
  );
}
