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

function cloneState() {
  return {
    apps: state.apps,
    events: state.events,
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
            item => item.requestId === payload.requestId,
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

    const withFailure = withWorkflow.handle(
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
