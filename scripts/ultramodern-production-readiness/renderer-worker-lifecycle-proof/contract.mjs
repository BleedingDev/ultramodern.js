import assert from 'node:assert/strict';

export const candidateFields = [
  'sourceRevision',
  'releaseVersion',
  'manifestSha256',
  'frameworkCohortDigest',
];

export const controlHeader = 'x-renderer-lifecycle-token';
export const candidateHeader = 'x-renderer-lifecycle-candidate';
export const receiptHeader = 'x-renderer-lifecycle-receipt';
export const bindingVariable = 'LIFECYCLE_WORKER_TOKEN';

export function validateCandidateBinding(binding) {
  assert(binding && typeof binding === 'object' && !Array.isArray(binding));
  assert.deepEqual(
    Reflect.ownKeys(binding).sort(),
    [...candidateFields].sort(),
    'Worker lifecycle evidence requires exactly the four candidate fields',
  );
  for (const field of candidateFields)
    assert.equal(typeof binding[field], 'string', `${field} must be a string`);
  assert(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(binding.sourceRevision));
  assert(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/u.test(
      binding.releaseVersion,
    ),
  );
  for (const field of ['manifestSha256', 'frameworkCohortDigest'])
    assert(/^[a-f0-9]{64}$/u.test(binding[field]), `${field} must bind bytes`);
  return Object.fromEntries(
    candidateFields.map(field => [field, binding[field]]),
  );
}

export function validateToken(token) {
  assert(
    typeof token === 'string' && /^[a-zA-Z0-9_-]{16,160}$/u.test(token),
    'The lifecycle token must be a fresh, header-safe opaque value',
  );
  return token;
}

export const defaultRoutes = [
  {
    entryName: 'lifecycleFetch',
    dispatchForm: 'fetch-export',
    filename: 'lifecycle-fetch.tsx',
    urlPath: '/lifecycle-fetch-export',
  },
  {
    entryName: 'lifecycleRequest',
    dispatchForm: 'request-handler',
    filename: 'lifecycle-request.tsx',
    urlPath: '/lifecycle-request-handler',
  },
];

export function validateRoutes(routes) {
  assert(Array.isArray(routes) && routes.length === 2);
  assert.deepEqual(routes.map(route => route.dispatchForm).sort(), [
    'fetch-export',
    'request-handler',
  ]);
  for (const route of routes) {
    for (const field of ['entryName', 'urlPath', 'filename'])
      assert.equal(typeof route[field], 'string', `${field} must be a string`);
    assert(/^[a-zA-Z][a-zA-Z0-9]*$/u.test(route.entryName));
    assert(/^\/[-a-zA-Z0-9_/]+$/u.test(route.urlPath));
    assert(/^[a-zA-Z0-9_-]+\.tsx$/u.test(route.filename));
  }
  for (const field of ['entryName', 'urlPath', 'filename'])
    assert.equal(new Set(routes.map(route => route[field])).size, 2);
  return routes.map(route => ({ ...route }));
}
