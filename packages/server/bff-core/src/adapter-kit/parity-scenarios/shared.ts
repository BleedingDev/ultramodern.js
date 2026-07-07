import type {
  CrossProjectOperationContract,
  CrossProjectPolicyViolationReason,
} from '../../security/crossProjectPolicy';

export const PARITY_REQUEST_ID = 'crm';
export const PARITY_PRODUCER_REQUEST_ID = 'crm.producer-a';

export type ParityExpectation =
  | { kind: 'payload'; status: number; payload: unknown }
  | {
      kind: 'denied';
      status: number;
      reason: CrossProjectPolicyViolationReason;
    };

export type AdapterParityScenario = {
  name: string;
  /** Run against policy-enabled server instead of the open one. */
  policy: boolean;
  request: {
    method: 'get' | 'post' | 'patch';
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  expected: ParityExpectation;
};

export type AdapterParityScenarioContext = {
  helloContract: CrossProjectOperationContract;
  validEnvelope: string;
  validOperationId: string;
};

export const envelopeHeader = (requestId: unknown) =>
  JSON.stringify(requestId === undefined ? {} : { requestId });

export const detailHeader = (details: Record<string, unknown>) =>
  JSON.stringify(details);

export const deniedScenario = (
  name: string,
  reason: CrossProjectPolicyViolationReason,
  headers: Record<string, string>,
): AdapterParityScenario => ({
  name,
  policy: true,
  request: { method: 'get', path: '/hello', headers },
  expected: { kind: 'denied', status: 403, reason },
});
