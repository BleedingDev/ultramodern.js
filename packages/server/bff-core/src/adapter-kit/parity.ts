import type { APIHandlerInfo } from '../router';
import { buildOperationContractMap } from '../security/operationContracts';
import { HttpMethod } from '../types';
import { createCrossProjectDenialScenarios } from './parity-scenarios/cross-project-denial';
import { createEnvelopeParityScenarios } from './parity-scenarios/envelope';
import {
  createOperationContextDenialScenarios,
  createOperationContextSuccessScenarios,
} from './parity-scenarios/operation-context';
import { createSchemaParityScenarios } from './parity-scenarios/schema';
import type { AdapterParityScenario } from './parity-scenarios/shared';
import {
  envelopeHeader,
  PARITY_PRODUCER_REQUEST_ID,
  PARITY_REQUEST_ID,
} from './parity-scenarios/shared';

export type {
  AdapterParityScenario,
  ParityExpectation,
} from './parity-scenarios/shared';
export {
  PARITY_PRODUCER_REQUEST_ID,
  PARITY_REQUEST_ID,
} from './parity-scenarios/shared';

/**
 * Adapter parity (conformance) kit.
 *
 * One shared scenario table is executed by the supported Hono BFF server
 * adapter in its test harness. Each scenario asserts the observable result:
 * HTTP status, payload value, and policy-rejection reason.
 *
 * This is internal test support rather than a package subpath. The live
 * executable consumer is the Hono lane test
 * (`@modern-js/plugin-bff` runs it against `createHonoRoutes` plus
 * cross-project policy middleware), while bff-core tests validate table
 * shape and assertion helpers.
 *
 * Transport details are intentionally NOT asserted; {@link toParityResult}
 * normalizes JSON and text responses to the decoded payload value before
 * comparison.
 *
 * The table intentionally tracks current Hono behavior only; historical
 * adapter drift belongs in release notes, not executable conformance data.
 */
const PARITY_FIXTURE_FILENAME = 'bff-core/adapter-kit/parity-fixture.ts';

const HANDLER_WITH_SCHEMA = 'HANDLER_WITH_SCHEMA';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const createSchemaFixtureHandler = (): APIHandlerInfo['handler'] => {
  const handler = (input: unknown) => {
    const data =
      isRecord(input) && isRecord(input.data) ? input.data : undefined;
    const id = data?.id;
    if (typeof id === 'number') {
      return { type: 'HandleSuccess', value: { id } };
    }
    if (id === 'boom') {
      return { type: 'OutputValidationError', message: 'invalid output' };
    }
    return { type: 'InputValidationError', message: 'invalid input' };
  };
  return Object.assign(handler, { [HANDLER_WITH_SCHEMA]: true });
};

/**
 * Handler fixtures registered in both adapters before running the table.
 */
export const createParityApiHandlerInfos = (): APIHandlerInfo[] => [
  {
    name: 'getHello',
    httpMethod: HttpMethod.Get,
    routeName: '/hello',
    routePath: '/hello',
    filename: PARITY_FIXTURE_FILENAME,
    handler: () => ({ message: 'hello' }),
  },
  {
    name: 'postHello',
    httpMethod: HttpMethod.Post,
    routeName: '/hello',
    routePath: '/hello',
    filename: PARITY_FIXTURE_FILENAME,
    handler: () => 'hello',
  },
  {
    name: 'getNothing',
    httpMethod: HttpMethod.Get,
    routeName: '/nothing',
    routePath: '/nothing',
    filename: PARITY_FIXTURE_FILENAME,
    handler: () => undefined,
  },
  {
    name: 'postEcho',
    httpMethod: HttpMethod.Post,
    routeName: '/echo',
    routePath: '/echo',
    filename: PARITY_FIXTURE_FILENAME,
    handler: (input: unknown) => {
      const normalized = isRecord(input) ? input : {};
      return {
        data: normalized.data ?? null,
        query: normalized.query ?? {},
        cookie: normalized.cookies ?? null,
      };
    },
  },
  {
    name: 'getItem',
    httpMethod: HttpMethod.Get,
    routeName: '/items/:id',
    routePath: '/items/:id',
    filename: PARITY_FIXTURE_FILENAME,
    handler: (id: unknown, input: unknown) => ({
      id,
      query: isRecord(input) ? (input.query ?? {}) : {},
    }),
  },
  {
    name: 'patchSchema',
    httpMethod: HttpMethod.Patch,
    routeName: '/schema',
    routePath: '/schema',
    filename: PARITY_FIXTURE_FILENAME,
    handler: createSchemaFixtureHandler(),
  },
];

/**
 * `bff` config slice for policy-enabled parity server. All `require*`
 * switches stay at strict defaults.
 */
export const createParityBffConfig = () => ({
  requestId: PARITY_PRODUCER_REQUEST_ID,
  crossProjectPolicy: {
    enabled: true,
    allowedNamespaces: [PARITY_REQUEST_ID],
    allowClientAssertedNamespace: true,
  },
});

const getParityContracts = () =>
  buildOperationContractMap({
    handlers: createParityApiHandlerInfos(),
    requestId: PARITY_PRODUCER_REQUEST_ID,
  });

export const createAdapterParityScenarios = (): AdapterParityScenario[] => {
  const contracts = getParityContracts();
  const helloContract = contracts['GET:/hello'];
  const validEnvelope = envelopeHeader(PARITY_PRODUCER_REQUEST_ID);
  const validOperationId = helloContract.operationId;
  const context = { helloContract, validEnvelope, validOperationId };

  return [
    ...createEnvelopeParityScenarios(),
    ...createSchemaParityScenarios(),
    ...createOperationContextSuccessScenarios(context),
    ...createCrossProjectDenialScenarios(),
    ...createOperationContextDenialScenarios(context),
  ];
};

/** Structural slice of supertest response used for normalization. */
export type ParityHttpResponse = {
  status: number;
  /** Content-type mime, e.g. `application/json`. */
  type: string;
  body: unknown;
  text: string;
};

type AdapterParityResult = {
  status: number;
  payload: unknown;
};

/**
 * Normalizes raw HTTP response into an observable payload value so JSON and
 * text encodings of the same scalar compare equal.
 */
export const toParityResult = (
  res: ParityHttpResponse,
): AdapterParityResult => ({
  status: res.status,
  payload: res.type.includes('json')
    ? res.body
    : res.text === ''
      ? undefined
      : res.text,
});

const formatValue = (value: unknown) => JSON.stringify(value);

/**
 * Framework-agnostic assertion: throws a descriptive error when adapter
 * response deviates from the scenario expectation.
 */
export const assertParityResult = (
  scenario: AdapterParityScenario,
  res: ParityHttpResponse,
): void => {
  const result = toParityResult(res);
  const failures: string[] = [];
  const { expected } = scenario;

  if (result.status !== expected.status) {
    failures.push(
      `status: expected ${expected.status}, received ${result.status}`,
    );
  }

  if (expected.kind === 'payload') {
    if (formatValue(result.payload) !== formatValue(expected.payload)) {
      failures.push(
        `payload: expected ${formatValue(expected.payload)}, received ${formatValue(result.payload)}`,
      );
    }
  } else {
    const payload = isRecord(result.payload) ? result.payload : {};
    if (payload.code !== 'BFF_CROSS_PROJECT_POLICY_DENIED') {
      failures.push(
        `denial code: expected "BFF_CROSS_PROJECT_POLICY_DENIED", received ${formatValue(payload.code)}`,
      );
    }
    if (payload.reason !== expected.reason) {
      failures.push(
        `denial reason: expected "${expected.reason}", received ${formatValue(payload.reason)}`,
      );
    }
    if (typeof payload.message !== 'string' || payload.message.length === 0) {
      failures.push(
        `denial message: expected non-empty string, received ${formatValue(payload.message)}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Adapter parity scenario "${scenario.name}" failed:\n- ${failures.join('\n- ')}`,
    );
  }
};
