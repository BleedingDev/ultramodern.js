import {
  createEventEnvelope,
  defineEventContract,
  isEventEnvelope,
} from '../src/contracts/eventContracts';

describe('event contracts', () => {
  test('defines typed event contracts and envelopes', () => {
    const contract = defineEventContract<`crm.${string}`, { id: string }>({
      name: 'crm.customer.updated',
      version: 1,
      schemaHash: 'sha256:abc123',
    });

    const envelope = createEventEnvelope(contract, {
      id: 'customer-1',
    });

    expect(envelope.name).toBe('crm.customer.updated');
    expect(envelope.version).toBe(1);
    expect(envelope.schemaHash).toBe('sha256:abc123');
    expect(envelope.payload).toEqual({ id: 'customer-1' });
    expect(isEventEnvelope(envelope)).toBe(true);
  });

  test('rejects invalid contracts', () => {
    expect(() =>
      defineEventContract({
        name: '',
        version: 1,
        schemaHash: 'hash',
      }),
    ).toThrow('Event contract name must be non-empty');

    expect(() =>
      defineEventContract({
        name: 'crm.customer.updated',
        version: 0,
        schemaHash: 'hash',
      }),
    ).toThrow('Event contract version must be a positive number');
  });
});
