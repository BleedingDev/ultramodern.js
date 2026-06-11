import { getInitialContext } from '../../../src/core/context';
import { createRuntimeContextExtension } from '../../../src/core/context/extensions';

describe('runtime context extensions', () => {
  it('stores and retrieves typed values per context object', () => {
    const extension = createRuntimeContextExtension<{ value: number }>(
      'test:isolation-a',
    );
    const contextA = getInitialContext(true);
    const contextB = getInitialContext(true);

    extension.set(contextA, { value: 1 });
    extension.set(contextB, { value: 2 });

    expect(extension.get(contextA)).toEqual({ value: 1 });
    expect(extension.get(contextB)).toEqual({ value: 2 });

    extension.remove(contextA);
    expect(extension.get(contextA)).toBeUndefined();
    expect(extension.get(contextB)).toEqual({ value: 2 });
  });

  it('isolates extensions with different ids on the same context', () => {
    const first = createRuntimeContextExtension<string>('test:first');
    const second = createRuntimeContextExtension<string>('test:second');
    const context = getInitialContext(true);

    first.set(context, 'one');
    second.set(context, 'two');

    expect(first.get(context)).toBe('one');
    expect(second.get(context)).toBe('two');
  });

  it('shares state between extensions created with the same id', () => {
    const a = createRuntimeContextExtension<string>('test:shared');
    const b = createRuntimeContextExtension<string>('test:shared');
    const context = getInitialContext(true);

    a.set(context, 'value');
    expect(b.get(context)).toBe('value');
  });

  it('returns undefined for contexts without any extensions', () => {
    const extension = createRuntimeContextExtension<string>('test:empty');
    expect(extension.get({})).toBeUndefined();
  });

  it('does not leak into string-key enumeration of the context', () => {
    const extension = createRuntimeContextExtension<string>('test:hidden');
    const context = getInitialContext(true);
    const keysBefore = Object.keys(context);

    extension.set(context, 'secret');

    expect(Object.keys(context)).toEqual(keysBefore);
    expect(JSON.stringify(context)).not.toContain('secret');
    for (const key in context) {
      expect(typeof key).toBe('string');
      expect((context as Record<string, unknown>)[key]).not.toBe('secret');
    }
  });

  it('survives object spreads so SSR context copies keep their extensions', () => {
    const extension = createRuntimeContextExtension<string>('test:spread');
    const context = getInitialContext(true);
    extension.set(context, 'carried');

    const copy = { ...context };
    expect(extension.get(copy)).toBe('carried');
  });
});
