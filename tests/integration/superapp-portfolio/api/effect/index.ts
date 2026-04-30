import {
  defineEffectBff,
  Effect,
  HttpApiBuilder,
  Layer,
} from '@modern-js/plugin-bff/effect-server';
import { portfolioApi } from '../../shared/portfolio-api.js';
import {
  createInitialPortfolioState,
  type PilotChaosMode,
  type PilotModuleId,
  type PilotModuleResult,
  type PilotRun,
  type PilotScenario,
  type PortfolioAppId,
  type PortfolioState,
  summarizePortfolio,
  type WorkflowEvent,
} from '../../shared/portfolio-state.js';

let state: PortfolioState = createInitialPortfolioState();
let eventCounter = state.events.length;
const trustedOrigins = new Set(['https://superapp.test', 'http://localhost']);
const tenantRoles: Record<string, string[]> = {
  'superapp-global': ['superapp-operator', 'security-admin'],
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
    pilotRuns: state.pilotRuns,
    summary: summarizePortfolio(state),
  };
}

const moduleAppMap: Record<PilotModuleId, PortfolioAppId> = {
  rides: 'mobility-marketplace',
  dispatch: 'mobility-marketplace',
  orders: 'enterprise-mega-erp',
  erp: 'enterprise-mega-erp',
  chat: 'mobility-marketplace',
  'mf-remotes': 'mf-platform',
  security: 'tenant-security',
  billing: 'enterprise-mega-erp',
};

const moduleBudgets: Record<PilotModuleId, number> = {
  rides: 750,
  dispatch: 900,
  orders: 1200,
  erp: 1500,
  chat: 650,
  'mf-remotes': 1800,
  security: 700,
  billing: 1100,
};

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

function createPilotRun(input: {
  scenario: PilotScenario;
  payload: {
    tenant: string;
    actor: string;
    requestId: string;
    modules: PilotModuleId[];
    chaos?: PilotChaosMode;
  };
}) {
  const existing = state.pilotRuns.find(
    run =>
      run.scenario === input.scenario &&
      run.tenant === input.payload.tenant &&
      run.requestId === input.payload.requestId,
  );
  if (existing) {
    return {
      run: {
        ...existing,
        status: 'deduped' as const,
      },
      summary: summarizePortfolio(state),
    };
  }

  const tenantAccess = state.tenantAccess[input.payload.tenant] ?? [];
  if (tenantAccess.length === 0) {
    throw new Error(`Unknown tenant: ${input.payload.tenant}`);
  }

  const modules = [...new Set(input.payload.modules)];
  if (modules.length === 0) {
    throw new Error('Pilot run requires at least one module');
  }

  for (const module of modules) {
    const appId = moduleAppMap[module];
    if (!tenantAccess.includes(appId)) {
      throw new Error(
        `Tenant ${input.payload.tenant} cannot access pilot module ${module}`,
      );
    }
  }

  const chaos = input.payload.chaos ?? 'none';
  if (['remote-down', 'api-timeout', 'chunk-404'].includes(chaos)) {
    state.failureMode = chaos as PortfolioState['failureMode'];
  }

  let remoteFallbacks = 0;
  let chatMessages = 0;
  let approvals = 0;
  let securityChecks = 0;
  const moduleResults: PilotModuleResult[] = modules.map(module => {
    const appId = moduleAppMap[module];
    const degraded =
      (module === 'mf-remotes' &&
        ['remote-down', 'chunk-404', 'restart-during-load'].includes(chaos)) ||
      (module === 'erp' && chaos === 'api-timeout') ||
      (module === 'billing' && chaos === 'clock-skew');
    const ok = chaos === 'api-timeout' ? module !== 'erp' : true;
    if (degraded && module === 'mf-remotes') {
      remoteFallbacks += 1;
    }
    if (module === 'chat') {
      chatMessages += 1;
    }
    if (module === 'orders' || module === 'billing') {
      approvals += 1;
    }
    if (module === 'security') {
      securityChecks += 1;
    }

    eventCounter += 1;
    state.events.push({
      id: `evt-${eventCounter}`,
      appId,
      action: `pilot:${input.scenario}:${module}`,
      actor: input.payload.actor,
      requestId: `${input.payload.requestId}:${module}`,
      status: 'accepted',
    });

    const app = state.apps.find(item => item.id === appId);
    if (app) {
      app.openWork = Math.max(0, app.openWork - 1);
    }

    return {
      module,
      appId,
      ok,
      degraded,
      invariant: ok
        ? `${module}:contract-preserved`
        : `${module}:fallback-required`,
      durationBudgetMs: moduleBudgets[module],
    };
  });

  const run: PilotRun = {
    id: `pilot-${state.pilotRuns.length + 1}`,
    requestId: input.payload.requestId,
    scenario: input.scenario,
    tenant: input.payload.tenant,
    actor: input.payload.actor,
    status: 'accepted',
    chaos,
    moduleResults,
    summary: {
      workflowEvents: moduleResults.length,
      chatMessages,
      approvals,
      remoteFallbacks,
      securityChecks,
      degradedModules: moduleResults.filter(result => result.degraded).length,
    },
  };
  state.pilotRuns.push(run);

  return {
    run,
    summary: summarizePortfolio(state),
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

    const withPilotRun = withWorkflow.handle(
      'runPilot',
      ({ params, payload }: any) =>
        Effect.sync(() =>
          createPilotRun({
            scenario: params.scenario,
            payload,
          }),
        ).pipe(
          Effect.withSpan('superapp.portfolio.pilot.run', {
            attributes: {
              'pilot.scenario': params.scenario,
              'pilot.tenant': payload.tenant,
              'pilot.request_id': payload.requestId,
              'pilot.chaos': payload.chaos ?? 'none',
            },
          }),
        ),
    );

    const withSecurityProbe = withPilotRun.handle(
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
