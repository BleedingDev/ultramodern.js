// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off strictBooleanExpressions:off
import {
  defineEffectBff,
  Effect,
  HttpApiBuilder,
  Layer,
} from '@modern-js/plugin-bff/effect-server';
import { portfolioApi } from '../../shared/portfolio-api';
import {
  createInitialPortfolioState,
  type PilotChaosMode,
  type PilotModuleId,
  type PilotModuleResult,
  type PilotRun,
  type PilotScenario,
  type PortfolioAppId,
  type PortfolioErpChatMessage,
  type PortfolioState,
  summarizePortfolio,
  summarizePortfolioErp,
  type WorkflowEvent,
} from '../../shared/portfolio-state';
import {
  createSuperAppChaosFailureEnvelope,
  createSuperAppChaosToggleDescriptor,
  isSuperAppLegacyFailureMode,
  isWorkloadChaosFailureId,
  type SuperAppChaosToggleDescriptor,
  type SuperAppChaosToggleEndpoint,
} from '../../shared/workload-chaos-toggles';

let state: PortfolioState = createInitialPortfolioState();
let eventCounter = state.events.length;
let erpMessageCounter = state.erp.chat.length;
const chaosToggles = new Map<string, SuperAppChaosToggleDescriptor>();
const trustedOrigins = new Set([
  'https://superapp.test',
  'https://superapp.example.test',
  'http://localhost',
]);
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
    pilotScenarios: state.pilotScenarios,
    workloadCatalog: state.workloadCatalog,
    workloadData: state.workloadData,
    workloadScenarioProfileMetadata: state.workloadScenarioProfileMetadata,
    workloadResetSeedMetadata: state.workloadResetSeedMetadata,
    events: state.events,
    pilotRuns: state.pilotRuns,
    summary: summarizePortfolio(state),
    erp: cloneErpState(),
  };
}

function cloneErpState() {
  return {
    tenant: state.erp.tenant,
    modules: state.erp.modules,
    approvals: state.erp.approvals,
    chat: state.erp.chat,
    summary: summarizePortfolioErp(state.erp),
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

function chaosToggleKey(toggle: SuperAppChaosToggleDescriptor) {
  return `${toggle.id}:${toggle.scope}:${toggle.targetEndpoint}:${toggle.targetRequestId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function matchEffectEndpoint(pathname: string):
  | {
      endpoint: SuperAppChaosToggleEndpoint;
      appId?: PortfolioAppId;
    }
  | undefined {
  const workflowMatch = pathname.match(/\/effect\/apps\/([^/]+)\/workflow$/);
  if (workflowMatch) {
    return {
      endpoint: 'portfolio.workflow',
      appId: workflowMatch[1] as PortfolioAppId,
    };
  }

  if (/\/effect\/pilot\/[^/]+\/run$/.test(pathname)) {
    return {
      endpoint: 'portfolio.pilot',
    };
  }

  if (pathname.endsWith('/effect/security/probe')) {
    return {
      endpoint: 'portfolio.security',
    };
  }

  return undefined;
}

function tenantIdForChaosEnvelope(input: {
  endpoint: SuperAppChaosToggleEndpoint;
  appId?: PortfolioAppId;
  payload: Record<string, unknown>;
  request: Request;
  toggle: SuperAppChaosToggleDescriptor;
}) {
  const tenantHeader = input.request.headers.get('x-tenant-id') ?? undefined;
  if (input.endpoint === 'portfolio.pilot') {
    return (
      getString(input.payload.tenant) ??
      tenantHeader ??
      input.toggle.id.split('.')[1] ??
      'absent'
    );
  }

  if (input.endpoint === 'portfolio.security') {
    return (
      tenantHeader ??
      getString(input.payload.tenant) ??
      getString(input.payload.targetTenant) ??
      'absent'
    );
  }

  return (
    tenantHeader ??
    state.apps.find(app => app.id === input.appId)?.tenant ??
    'absent'
  );
}

async function readJsonObject(request: Request) {
  try {
    const payload = await request.clone().json();
    return {
      malformed: false,
      payload: isRecord(payload) ? payload : undefined,
    };
  } catch {
    return {
      malformed: true,
      payload: undefined,
    };
  }
}

function consumeChaosToggle(input: {
  endpoint: SuperAppChaosToggleEndpoint;
  requestId: string;
}) {
  for (const [key, toggle] of chaosToggles) {
    if (
      toggle.targetEndpoint === input.endpoint &&
      toggle.targetRequestId === input.requestId
    ) {
      if (toggle.scope === 'request') {
        chaosToggles.delete(key);
      }

      return toggle;
    }
  }

  return undefined;
}

function consumeMalformedJsonChaosToggle(input: {
  endpoint: SuperAppChaosToggleEndpoint;
}) {
  for (const [key, toggle] of chaosToggles) {
    if (
      toggle.targetEndpoint === input.endpoint &&
      toggle.kind === 'malformed-json'
    ) {
      if (toggle.scope === 'request') {
        chaosToggles.delete(key);
      }

      return toggle;
    }
  }

  return undefined;
}

function createChaosToggleResponse(input: {
  toggle: SuperAppChaosToggleDescriptor;
  endpoint: {
    endpoint: SuperAppChaosToggleEndpoint;
    appId?: PortfolioAppId;
  };
  payload: Record<string, unknown>;
  request: Request;
  requestId: string;
}) {
  const envelope = createSuperAppChaosFailureEnvelope({
    toggle: input.toggle,
    requestId: input.requestId,
    tenantId: tenantIdForChaosEnvelope({
      endpoint: input.endpoint.endpoint,
      appId: input.endpoint.appId,
      payload: input.payload,
      request: input.request,
      toggle: input.toggle,
    }),
  });

  return new Response(JSON.stringify(envelope), {
    status: input.toggle.expectedHttpStatus,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

async function maybeHandleChaosToggle(request: Request) {
  if (request.method !== 'POST') {
    return undefined;
  }

  const endpoint = matchEffectEndpoint(new URL(request.url).pathname);
  if (!endpoint) {
    return undefined;
  }

  const json = await readJsonObject(request);
  if (json.malformed) {
    const toggle = consumeMalformedJsonChaosToggle({
      endpoint: endpoint.endpoint,
    });
    if (!toggle) {
      return undefined;
    }

    return createChaosToggleResponse({
      toggle,
      endpoint,
      payload: {},
      request,
      requestId: toggle.targetRequestId,
    });
  }

  const payload = json.payload;
  const requestId = getString(payload?.requestId);
  if (!payload || !requestId) {
    return undefined;
  }

  const toggle = consumeChaosToggle({
    endpoint: endpoint.endpoint,
    requestId,
  });
  if (!toggle) {
    return undefined;
  }

  if (toggle.kind === 'duplicate-request') {
    return undefined;
  }

  return createChaosToggleResponse({
    toggle,
    endpoint,
    payload,
    request,
    requestId,
  });
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
    modules: readonly PilotModuleId[];
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

  const scenarioPlan = state.pilotScenarios.find(
    item => item.scenario === input.scenario,
  );
  if (!scenarioPlan) {
    throw new Error(`Unknown pilot scenario: ${input.scenario}`);
  }

  const modules = [...new Set(input.payload.modules)];
  if (modules.length === 0) {
    throw new Error('Pilot run requires at least one module');
  }

  const missingModules = scenarioPlan.modules.filter(
    module => !modules.includes(module),
  );
  if (missingModules.length > 0) {
    throw new Error(
      `Pilot scenario ${input.scenario} requires modules: ${missingModules.join(
        ', ',
      )}`,
    );
  }

  if (!scenarioPlan.chaosModes.includes(input.payload.chaos ?? 'none')) {
    throw new Error(
      `Pilot scenario ${input.scenario} does not support chaos mode ${
        input.payload.chaos ?? 'none'
      }`,
    );
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
    scenarioLabel: scenarioPlan.label,
    tenant: input.payload.tenant,
    actor: input.payload.actor,
    status: 'accepted',
    chaos,
    moduleResults,
    productionChecks: [
      ...scenarioPlan.workflows.map(workflow => `workflow:${workflow}`),
      ...scenarioPlan.invariants.map(invariant => `invariant:${invariant}`),
      ...scenarioPlan.routeTransitions.map(route => `route:${route}`),
    ],
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
  handlers => {
    const withBootstrap = handlers.handle('bootstrap', () =>
      Effect.succeed(cloneState()),
    );

    const withErpBootstrap = withBootstrap.handle('erpBootstrap', () =>
      Effect.succeed(cloneErpState()),
    );

    const withErpApproval = withErpBootstrap.handle(
      'decideErpApproval',
      ({ params, payload }) =>
        Effect.sync(() => {
          const approval = state.erp.approvals.find(
            item => item.id === params.id,
          );
          if (!approval) {
            throw new Error(`Unknown ERP approval: ${params.id}`);
          }

          approval.status = payload.decision;

          return {
            id: approval.id,
            status: approval.status,
            actor: payload.actor,
            pendingApprovals: summarizePortfolioErp(state.erp).pendingApprovals,
          };
        }).pipe(
          Effect.withSpan('superapp.portfolio.erp.approval.decision', {
            attributes: {
              'approval.id': params.id,
              'approval.actor': payload.actor,
            },
          }),
        ),
    );

    const withErpChat = withErpApproval.handle('sendErpChat', ({ payload }) =>
      Effect.sync(() => {
        erpMessageCounter += 1;
        const message: PortfolioErpChatMessage = {
          id: `msg-${erpMessageCounter}`,
          channel: payload.channel,
          author: payload.author,
          text: payload.text,
          priority: payload.priority,
        };
        state.erp.chat.push(message);
        return {
          accepted: true,
          message,
          totalMessages: state.erp.chat.length,
        };
      }).pipe(
        Effect.withSpan('superapp.portfolio.erp.chat.send', {
          attributes: {
            'chat.channel': payload.channel,
            'chat.priority': payload.priority,
          },
        }),
      ),
    );

    const withWorkflow = withErpChat.handle(
      'runWorkflow',
      ({ params, payload }) =>
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
      ({ params, payload }) =>
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
      ({ headers, payload }) =>
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
      ({ params, payload }) =>
        Effect.sync(() => {
          const mode = String(params.mode);
          eventCounter += 1;
          const eventId = `evt-${eventCounter}`;
          state.events.push({
            id: eventId,
            appId: 'failure-lab',
            action: mode,
            actor: payload.actor,
            requestId: payload.requestId ?? `failure-${eventCounter}`,
            status: 'accepted',
          });

          if (isWorkloadChaosFailureId(mode)) {
            const chaosToggle = createSuperAppChaosToggleDescriptor({
              id: mode,
              scope: payload.scope,
              targetRequestId: payload.targetRequestId,
              targetEndpoint: payload.targetEndpoint,
              armedBy: payload.actor,
              reason: payload.reason,
              armedAtEventId: eventId,
            });
            chaosToggles.set(chaosToggleKey(chaosToggle), chaosToggle);

            return {
              failureMode: state.failureMode,
              chaosToggle,
              summary: summarizePortfolio(state),
            };
          }

          if (!isSuperAppLegacyFailureMode(mode)) {
            throw new Error(`Unknown failure mode: ${mode}`);
          }

          state.failureMode = mode;

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
        erpMessageCounter = state.erp.chat.length;
        chaosToggles.clear();
        return {
          ok: true,
          workloadResetSeedMetadata: state.workloadResetSeedMetadata,
          summary: summarizePortfolio(state),
        };
      }),
    );
  },
);

const layer = HttpApiBuilder.layer(portfolioApi).pipe(
  Layer.provide(portfolioLayer),
);

const runtime = defineEffectBff({
  api: portfolioApi,
  layer,
  interceptRequest: async ({ request, next }) => {
    const chaosResponse = await maybeHandleChaosToggle(request);
    return chaosResponse ?? next();
  },
});

export default runtime;
