import { evaluateCrossProjectPolicy } from '../src/security/crossProjectPolicy';

describe('cross-project policy', () => {
  test('should skip policy checks when disabled', () => {
    expect(evaluateCrossProjectPolicy({}, { enabled: false })).toBeNull();
  });

  test('should deny missing envelope when policy is enabled', () => {
    const violation = evaluateCrossProjectPolicy(
      {},
      {
        enabled: true,
      },
    );

    expect(violation?.reason).toBe('missing_envelope');
    expect(violation?.status).toBe(403);
  });

  test('should deny invalid envelope payload', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': 'not-json',
      },
      {
        enabled: true,
      },
    );

    expect(violation?.reason).toBe('invalid_envelope');
  });

  test('should deny namespace outside allowlist', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: 'billing.producer-a',
        }),
        'x-operation-id': 'billing.producer-a:GET:/api/invoice',
      },
      {
        enabled: true,
        allowedNamespaces: ['crm'],
      },
    );

    expect(violation?.reason).toBe('namespace_not_allowed');
  });

  test('should deny missing operation context header', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: 'crm.producer-a',
        }),
      },
      {
        enabled: true,
      },
    );

    expect(violation?.reason).toBe('missing_operation_context');
  });

  test('should allow valid envelope and operation context', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: 'crm.producer-a',
        }),
        'x-operation-id': 'crm.producer-a:GET:/api/customer',
      },
      {
        enabled: true,
        allowedNamespaces: ['crm', 'billing'],
      },
    );

    expect(violation).toBeNull();
  });
});
