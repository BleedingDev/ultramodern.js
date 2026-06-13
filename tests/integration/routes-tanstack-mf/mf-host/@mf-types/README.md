# routes-tanstack-mf federation type goldens

This directory is intentionally committed test data for the
`routes-tanstack-mf` host typecheck. The files model the Module Federation
DTS artifacts produced for the fixture remotes so the host can typecheck
`remote/*`, `remote2/*`, and `loadRemote(...)` without building remotes first.

If remote exposes change, regenerate the fixture types with the
`routes-tanstack-mf` remotes and update these files in the same change as the
contract assertions in `tests/tanstack-mf-contract.test.ts`.
