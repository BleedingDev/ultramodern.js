import type { Context } from '@modern-js/server-runtime';
import { useHonoContext } from '@modern-js/server-runtime';

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

type HookContext = ReturnType<typeof useHonoContext>;
type ContextTypeContracts = [
  Expect<IsEqual<HookContext, Context>>,
  Expect<IsEqual<IsAny<HookContext>, false>>,
];

const typeContracts: ContextTypeContracts = [true, true];

export function assertBackendContextTypeContract() {
  void typeContracts;

  const context = useHonoContext();
  const method: string = context.req.method;
  const path: string = context.req.path;
  const url: string = context.req.url;
  const headerValue: string | undefined = context.req.header('x-contract');

  context.res.headers.set('x-contract', `${method}:${path}:${url}`);

  const consumeHeader: string | undefined = headerValue;
  void consumeHeader;

  // @ts-expect-error Headers.set requires both key and value
  context.res.headers.set('x-contract');
}
