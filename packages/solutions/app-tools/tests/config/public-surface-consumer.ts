import type { URL } from 'node:url';
import {
  getBuildConfigEnvironment,
  type ResolveEffectTsgoCompilerOptions,
  resolveEffectTsgoCompiler,
  withBuildConfigEnvironment,
} from '@modern-js/app-tools/config';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

const compilerOriginContract: Expect<
  Equal<ResolveEffectTsgoCompilerOptions['from'], string | URL>
> = true;
const compilerPath: string = resolveEffectTsgoCompiler({
  from: import.meta.url,
});
const environmentValue: string | undefined = getBuildConfigEnvironment(
  'PUBLIC_SURFACE_CONSUMER',
);
const configure = withBuildConfigEnvironment(
  'PUBLIC_SURFACE_CONSUMER',
  'enabled',
  config => config,
);
const configured = configure({ plugins: [] });

void compilerOriginContract;
void compilerPath;
void environmentValue;
void configured;
