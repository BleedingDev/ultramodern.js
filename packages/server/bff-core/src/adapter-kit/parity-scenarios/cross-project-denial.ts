import type { AdapterParityScenario } from './shared';
import { deniedScenario, envelopeHeader } from './shared';

export const createCrossProjectDenialScenarios =
  (): AdapterParityScenario[] => [
    deniedScenario('policy denies missing envelope', 'missing_envelope', {}),
    deniedScenario('policy denies invalid envelope', 'invalid_envelope', {
      'x-modernjs-bff-envelope': 'not-json',
    }),
    deniedScenario(
      'policy denies envelope that is valid JSON but not an object',
      'invalid_envelope',
      {
        'x-modernjs-bff-envelope': '123',
      },
    ),
    deniedScenario('policy denies missing requestId', 'missing_request_id', {
      'x-modernjs-bff-envelope': envelopeHeader(undefined),
    }),
    deniedScenario(
      'policy denies namespace outside allowlist',
      'namespace_not_allowed',
      {
        'x-modernjs-bff-envelope': envelopeHeader('billing.producer-z'),
      },
    ),
  ];
