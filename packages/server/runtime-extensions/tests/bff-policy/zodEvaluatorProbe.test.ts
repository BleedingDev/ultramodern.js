import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Operation contracts load the optional zod peer at runtime. Upstream zod
// decides lazily whether to probe `new Function("")` for its object JIT and
// skips the probe under `z.config({ jitless: true })` and on Cloudflare
// Workers, so CSP/Worker bundles need no evaluator patch.
const countFunctionConstructions = (setup: string) =>
  Number(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
let constructions = 0;
globalThis.Function = new Proxy(Function, {
  construct(target, args, newTarget) {
    constructions += 1;
    return Reflect.construct(target, args, newTarget);
  },
});
const { z } = await import('zod');
${setup}
z.object({ id: z.string(), count: z.number() }).parse({ id: 'a', count: 1 });
process.stdout.write(String(constructions));
`,
      ],
      { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' },
    ),
  );

describe('upstream zod evaluator probe', () => {
  test('constructs Function by default, proving the probe is observable', () => {
    expect(countFunctionConstructions('')).toBeGreaterThan(0);
  });

  test('never constructs Function on Cloudflare Workers', () => {
    expect(
      countFunctionConstructions(
        `Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Cloudflare-Workers' } });`,
      ),
    ).toBe(0);
  });

  test('never constructs Function under jitless configuration', () => {
    expect(countFunctionConstructions('z.config({ jitless: true });')).toBe(0);
  });
});
