import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  Schema,
} from '@modern-js/plugin-bff/effect-client';

const ModuleSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  status: Schema.Literals(['healthy', 'degraded']),
  openWork: Schema.Number,
});

const ApprovalSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  amount: Schema.Number,
  status: Schema.Literals(['pending', 'approved', 'rejected']),
  owner: Schema.String,
});

const ChatMessageSchema = Schema.Struct({
  id: Schema.String,
  channel: Schema.String,
  author: Schema.String,
  text: Schema.String,
  priority: Schema.Literals(['normal', 'urgent']),
});

export const superAppApi = HttpApi.make('SuperAppErpApi').add(
  HttpApiGroup.make('erp')
    .add(
      HttpApiEndpoint.get('bootstrap', '/effect/bootstrap', {
        success: Schema.Struct({
          tenant: Schema.Struct({
            id: Schema.String,
            name: Schema.String,
            region: Schema.String,
          }),
          modules: Schema.Array(ModuleSchema),
          approvals: Schema.Array(ApprovalSchema),
          chat: Schema.Array(ChatMessageSchema),
          summary: Schema.Struct({
            tenantName: Schema.String,
            moduleCount: Schema.Number,
            pendingApprovals: Schema.Number,
            urgentMessages: Schema.Number,
            totalOpenWork: Schema.Number,
            financeExposure: Schema.Number,
          }),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.post('decideApproval', '/effect/approval/:id/decision', {
        params: {
          id: Schema.String,
        },
        payload: Schema.Struct({
          decision: Schema.Literals(['approved', 'rejected']),
          actor: Schema.String,
        }),
        success: Schema.Struct({
          id: Schema.String,
          status: Schema.Literals(['approved', 'rejected']),
          actor: Schema.String,
          pendingApprovals: Schema.Number,
        }),
      }),
    )
    .add(
      HttpApiEndpoint.post('sendChat', '/effect/chat/send', {
        payload: Schema.Struct({
          channel: Schema.String,
          author: Schema.String,
          text: Schema.String,
          priority: Schema.Literals(['normal', 'urgent']),
        }),
        success: Schema.Struct({
          accepted: Schema.Boolean,
          message: ChatMessageSchema,
          totalMessages: Schema.Number,
        }),
      }),
    )
    .add(
      HttpApiEndpoint.post('reset', '/effect/reset', {
        success: Schema.Struct({
          ok: Schema.Boolean,
          pendingApprovals: Schema.Number,
          totalMessages: Schema.Number,
        }),
      }),
    ),
);
