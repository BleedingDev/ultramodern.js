// @effect-diagnostics anyUnknownInErrorContext:off strictBooleanExpressions:off
import {
  defineEffectBff,
  Effect,
  type EffectRuntimeLayer,
  HttpApiBuilder,
  Layer,
} from '@modern-js/plugin-bff/effect-server';
import { superAppApi } from '../../shared/superapp-api.js';
import {
  type ChatMessage,
  createInitialSuperAppState,
  type SuperAppState,
  summarizeSuperApp,
} from '../../shared/superapp-state.js';

let state: SuperAppState = createInitialSuperAppState();
let messageCounter = state.chat.length;

function cloneState() {
  return {
    tenant: state.tenant,
    modules: state.modules,
    approvals: state.approvals,
    chat: state.chat,
    summary: summarizeSuperApp(state),
  };
}

const erpLayer = HttpApiBuilder.group(superAppApi, 'erp', (handlers: any) => {
  const withBootstrap = handlers.handle('bootstrap', () =>
    Effect.succeed(cloneState()),
  );

  const withApprovalDecision = withBootstrap.handle(
    'decideApproval',
    ({ params, payload }: any) =>
      Effect.sync(() => {
        const approval = state.approvals.find(item => item.id === params.id);
        if (!approval) {
          throw new Error(`Unknown approval: ${params.id}`);
        }

        approval.status = payload.decision;

        return {
          id: approval.id,
          status: approval.status,
          actor: payload.actor,
          pendingApprovals: summarizeSuperApp(state).pendingApprovals,
        };
      }).pipe(
        Effect.withSpan('superapp.erp.approval.decision', {
          attributes: {
            'approval.id': params.id,
            'approval.actor': payload.actor,
          },
        }),
      ),
  );

  const withChat = withApprovalDecision.handle('sendChat', ({ payload }: any) =>
    Effect.sync(() => {
      messageCounter += 1;
      const message: ChatMessage = {
        id: `msg-${messageCounter}`,
        channel: payload.channel,
        author: payload.author,
        text: payload.text,
        priority: payload.priority,
      };
      state.chat.push(message);
      return {
        accepted: true,
        message,
        totalMessages: state.chat.length,
      };
    }).pipe(
      Effect.withSpan('superapp.erp.chat.send', {
        attributes: {
          'chat.channel': payload.channel,
          'chat.priority': payload.priority,
        },
      }),
    ),
  );

  return withChat.handle('reset', () =>
    Effect.sync(() => {
      state = createInitialSuperAppState();
      messageCounter = state.chat.length;
      return {
        ok: true,
        pendingApprovals: summarizeSuperApp(state).pendingApprovals,
        totalMessages: state.chat.length,
      };
    }),
  );
});

const layer = HttpApiBuilder.layer(superAppApi).pipe(
  Layer.provide(erpLayer),
) as EffectRuntimeLayer;

export default defineEffectBff({
  api: superAppApi,
  layer,
});
