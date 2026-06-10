---
name: ultramodern-public-web-deepen-05-generated-output-tests
overview: Narrow generated-output tests so they keep compatibility checks for public surfaces but rely more on generated artifact behavior than brittle string-internal mirroring.
todos:
  - id: classify-test-assertions
    content: Classify current integration assertions as public compatibility surfaces, generated artifact behavior, or implementation-internal string mirroring.
    status: pending
  - id: preserve-required-compatibility-checks
    content: Keep string-level checks only where they protect intentional compatibility surfaces such as CLI paths, env names, report fields, assertion names, and generated exports.
    status: pending
  - id: shift-to-artifact-behavior
    content: Replace safe implementation-internal string checks with generated script execution, contract outcome checks, or artifact output assertions.
    status: pending
  - id: validate-generated-output-tests
    content: Run create integration tests and inspect failures to ensure coverage was not narrowed or made less precise.
    status: pending
isProject: false
---

# ultramodern-public-web-deepen-05-generated-output-tests

## Execution Notes

The current tests provide locality but mirror generated implementation details in several places. This lane should improve test leverage after the route path, policy, and proof helper seams settle.

## Constraints

Do not delete compatibility coverage for generated public contracts, CLI flags, env vars, assertion names, provider behavior, private-first outputs, or generated exports. Do not reduce negative coverage or skip flaky assertions without replacing them.

## Operator Guidance

Run this as a downstream verification/refactor lane after implementation lanes, because test shape should follow the final module interfaces. Keep diffs reviewable and avoid broad snapshot churn.
