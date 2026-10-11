import type { Alias } from '@modern-js/utils/alias';
import type { ConfigChain } from './share';

export interface SourceUserConfig {
  alias?: ConfigChain<Alias>;
  enableAsyncEntry?: boolean;
}

export type SourceNormalizedConfig = SourceUserConfig;
