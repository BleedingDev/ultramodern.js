import { nativeDataCompletionCommitFailure } from './fixtures/routes-lifecycle';

test(
  'terminal transport failure during a native reactive commit reaches its route error',
  nativeDataCompletionCommitFailure,
);
