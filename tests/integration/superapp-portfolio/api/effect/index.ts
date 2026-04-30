import {
  defineEffectBff,
  Effect,
  HttpApiBuilder,
  Layer,
} from '@modern-js/plugin-bff/effect-server';
import { portfolioApi } from '../../shared/portfolio-api.js';
import {
  createInitialPortfolioState,
  type PortfolioAppId,
  type PortfolioState,
  summarizePortfolio,
  type WorkflowEvent,
} from '../../shared/portfolio-state.js';

let state: PortfolioState = createInitialPortfolioState();
let eventCounter = state.events.length;
const trustedOrigins = new Set(['https://superapp.test', 'http://localhost']);
const tenantRoles: Record<string, string[]> = {
  'city-ops-eu': ['mobility-operator', 'security-admin'],
  'acme-global': ['erp-operator', 'security-admin'],
  'platform-shell': ['platform-operator', 'security-admin'],
  'security-root': ['security-admin'],
  'chaos-lab': ['failure-operator', 'security-admin'],
};

function cloneState() {
  return {
    apps: state.apps,
    events: state.events,
    summary: summarizePortfolio(state),
  };
}

function normalizeOrigin(origin: string | undefined) {
  if (!origin) {
    return 'absent';
  }

  try {
    const parsed = new URL(origin);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return origin;
  }
}

function redact(value: string | undefined) {
  return value ? '[redacted]' : 'absent';
}

function createSecurityDecision(input: {
  headers: Record<string, string | undefined>;
  payload: {
    targetTenant: string;
    targetAppId: PortfolioAppId;
    action: string;
    requestId: string;
    mutation?: boolean;
  };
}) {
  const tenantId = input.headers['x-tenant-id'] ?? '';
  const role = input.headers['x-user-role'] ?? '';
  const origin = normalizeOrigin(input.headers.origin);
  const appAccess = state.tenantAccess[tenantId] ?? [];
  const allowedRoles = tenantRoles[input.payload.targetTenant] ?? [];
  const checks = [
    {
      id: 'auth:bearer-present',
      ok: Boolean(input.headers.authorization?.startsWith('Bearer ')),
    },
    {
      id: 'tenant:header-matches-target',
      ok: tenantId === input.payload.targetTenant,
    },
    {
      id: 'tenant:app-access',
      ok: appAccess.includes(input.payload.targetAppId),
    },
    {
      id: 'role:allowed-for-tenant',
      ok: allowedRoles.includes(role),
    },
    {
      id: 'csrf:mutation-token',
      ok:
        input.payload.mutation === false ||
        input.headers['x-csrf-token'] === 'superapp-valid-csrf',
    },
    {
      id: 'origin:trusted',
      ok:
        origin === 'absent' ||
        trustedOrigins.has(origin) ||
        /^http:\/\/localhost:\d+$/.test(origin),
    },
  ];
  const allowed = checks.every(check => check.ok);

  return {
    allowed,
    checks,
    telemetry: {
      tenant: tenantId || 'absent',
      appId: input.payload.targetAppId,
      requestId: input.payload.requestId,
      role: role || 'absent',
      origin,
      authorization: redact(input.headers.authorization),
      csrfToken: redact(input.headers['x-csrf-token']),
    },
  };
}

const portfolioLayer = HttpApiBuilder.group(
  portfolioApi,
  'portfolio',
  (handlers: any) => {
    const withBootstrap = handlers.handle('bootstrap', () =>
      Effect.succeed(cloneState()),
    );

    const withWorkflow = withBootstrap.handle(
      'runWorkflow',
      ({ params, payload }: any) =>
        Effect.sync(() => {
          const app = state.apps.find(item => item.id === params.appId);
          if (!app) {
            throw new Error(`Unknown portfolio app: ${params.appId}`);
          }

          const existing = state.events.find(
            item =>
              item.appId === params.appId &&
              item.requestId === payload.requestId,
          );
          if (existing) {
            return {
              event: {
                ...existing,
                status: 'deduped' as const,
              },
              summary: summarizePortfolio(state),
            };
          }

          eventCounter += 1;
          const event: WorkflowEvent = {
            id: `evt-${eventCounter}`,
            appId: params.appId as PortfolioAppId,
            action: payload.action,
            actor: payload.actor,
            requestId: payload.requestId,
            status: 'accepted',
          };
          state.events.push(event);
          app.openWork = Math.max(0, app.openWork - 1);

          return {
            event,
            summary: summarizePortfolio(state),
          };
        }).pipe(
          Effect.withSpan('superapp.portfolio.workflow', {
            attributes: {
              'app.id': params.appId,
              'workflow.action': payload.action,
              'workflow.actor': payload.actor,
            },
          }),
        ),
    );

    const withSecurityProbe = withWorkflow.handle(
      'securityProbe',
      ({ headers, payload }: any) =>
        Effect.sync(() => {
          const decision = createSecurityDecision({ headers, payload });
          if (!decision.allowed) {
            throw new Error('Security policy rejected request');
          }

          return decision;
        }).pipe(
          Effect.withSpan('superapp.portfolio.security.probe', {
            attributes: {
              'security.tenant': payload.targetTenant,
              'security.app': payload.targetAppId,
              'security.action': payload.action,
              'security.request_id': payload.requestId,
            },
          }),
        ),
    );

    const withFailure = withSecurityProbe.handle(
      'injectFailure',
      ({ params, payload }: any) =>
        Effect.sync(() => {
          state.failureMode = params.mode;
          eventCounter += 1;
          state.events.push({
            id: `evt-${eventCounter}`,
            appId: 'failure-lab',
            action: params.mode,
            actor: payload.actor,
            requestId: `failure-${eventCounter}`,
            status: 'accepted',
          });

          return {
            failureMode: state.failureMode,
            summary: summarizePortfolio(state),
          };
        }).pipe(
          Effect.withSpan('superapp.portfolio.failure.inject', {
            attributes: {
              'failure.mode': params.mode,
              'failure.actor': payload.actor,
            },
          }),
        ),
    );

    return withFailure.handle('reset', () =>
      Effect.sync(() => {
        state = createInitialPortfolioState();
        eventCounter = state.events.length;
        return {
          ok: true,
          summary: summarizePortfolio(state),
        };
      }),
    );
  },
);

const layer = HttpApiBuilder.layer(portfolioApi).pipe(
  Layer.provide(portfolioLayer),
);

export default defineEffectBff({
  api: portfolioApi,
  layer,
});
