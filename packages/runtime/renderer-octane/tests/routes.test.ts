// The native compiler host must transform the Octane router's published .tsrx
// dependencies before these tests execute. The admission runner imports the
// same assertions from this fixture without a React test compilation preset.
import * as contracts from './fixtures/routes-lifecycle';

describe('native Octane filesystem routes and serialization', () => {
  for (const [name, contract] of Object.entries(contracts)) {
    // This contract uses native reactive stores and belongs to the browser project.
    if (name === 'nativeDataCompletionCommitFailure') continue;
    test(name, contract);
  }
});
