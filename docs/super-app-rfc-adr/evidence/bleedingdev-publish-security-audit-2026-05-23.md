# BleedingDev Publish Security Audit - 2026-05-23

Scope: external publish controls for `BleedingDev/ultramodern.js` and the
`@bleedingdev` npm publish path. This is evidence for bead `modernjs-3bhl`.

## Result

The publish path is real and currently uses npm trusted publishing from GitHub
Actions, not npm tokens.

Repository-side controls were already present in code:

1. `.github/workflows/publish-bleedingdev.yml` grants `id-token: write`.
2. The publish job runs only on `workflow_dispatch`.
3. The publish job is guarded to `refs/heads/main-ultramodern`.
4. The publish job uses the `npm-publish` environment.
5. The publish job does not reference `NPM_TOKEN` or `NODE_AUTH_TOKEN`.
6. `.github/workflows/publish-bleedingdev.yml` validates the repository,
   branch, dispatch event, npm registry, latest-only tag, fixed concurrency, and
   version shape before release work; the workflow security gate rejects token
   environment variables.
7. `scripts/ultramodern-publish/prepare-bleedingdev-packages.mjs` publishes
   accepted bytes through npm trusted publishing with provenance.

Live external controls verified:

1. GitHub authenticated account: `BleedingDev`.
2. GitHub account 2FA: enabled, from `gh api user`.
3. Repository default branch: `main-ultramodern`.
4. Secret scanning: enabled.
5. Secret scanning push protection: enabled.
6. Repository Actions secrets: none.
7. `npm-publish` environment secrets: none.
8. Dependabot secrets: none.
9. Secret scanning open alerts: zero.
10. Latest checked publish workflow run: successful
    `https://github.com/BleedingDev/ultramodern.js/actions/runs/26170328264`.
11. Latest checked publish run emitted npm provenance confirmation from GitHub
    Actions.
12. `@bleedingdev/modern-js-create@3.2.0-ultramodern.21` has npm dist
    attestations with SLSA provenance.
13. `@bleedingdev/modern-js-create@3.2.0-ultramodern.21` shows npm publisher
    metadata as `GitHub Actions` with `trustedPublisher.id = github`.

External controls changed during this audit:

1. Enabled GitHub vulnerability alerts for `BleedingDev/ultramodern.js`.
2. Enabled GitHub Dependabot security updates for `BleedingDev/ultramodern.js`.
3. Configured the `npm-publish` environment with custom branch deployment
   policy.
4. Added `main-ultramodern` as the allowed deployment branch for the
   `npm-publish` environment.

Important remaining facts:

1. `main-ultramodern` is not branch-protected and no repository rulesets are
   configured. The publish workflow still has its own branch guard, and the
   `npm-publish` environment now has a matching branch policy.
2. Repository Actions default workflow permissions are still `write`. The
   publish workflow itself declares minimal `contents: read` and
   `id-token: write`; changing the repository default could affect older
   workflows that rely on implicit write permissions.
3. Dependabot alerts became visible after enabling vulnerability alerts. They
   were resolved separately in `d480b9ec17`.
4. Local npm CLI is not authenticated, so npm account profile 2FA and npm token
   inventory were verified through the npm web UI after interactive login.

## npm Account Follow-Up - 2026-05-23

Evidence for bead `modernjs-ov3p`:

1. npm logged-in user observed in the web UI: `pegak`.
2. Account 2FA status: enabled for authorization and publishing.
3. Account 2FA factor observed: authenticator app.
4. Account security keys observed: zero.
5. Access token inventory initially showed one stale token:
   `Techsio - MacOS`, created and last used on 2025-11-24, expired on
   2025-12-01.
6. The stale expired token was deleted from the npm web UI.
7. Access token inventory after deletion showed no token rows.
8. `bleedingdev` npm organization has one member: `pegak`, owner.
9. `bleedingdev` member 2FA status after verification: enabled 1, disabled 0.
10. `bleedingdev` organization 2FA enforcement was enabled.
11. npm UI confirmed: organization now has 2FA enforced.

## Evidence Commands

Key commands used:

```bash
gh api user --jq '{login,two_factor_authentication,plan:.plan.name}'
gh api repos/BleedingDev/ultramodern.js --jq '{full_name,visibility,default_branch,security_and_analysis}'
gh api repos/BleedingDev/ultramodern.js/actions/permissions --jq .
gh api repos/BleedingDev/ultramodern.js/actions/permissions/workflow --jq .
gh api repos/BleedingDev/ultramodern.js/environments --jq .
gh api repos/BleedingDev/ultramodern.js/environments/npm-publish/deployment-branch-policies --jq .
gh api repos/BleedingDev/ultramodern.js/actions/secrets --jq .
gh api repos/BleedingDev/ultramodern.js/environments/npm-publish/secrets --jq .
gh api repos/BleedingDev/ultramodern.js/dependabot/secrets --jq .
gh api 'repos/BleedingDev/ultramodern.js/secret-scanning/alerts?state=open' --paginate --jq 'length'
gh api 'repos/BleedingDev/ultramodern.js/dependabot/alerts?state=open' --paginate
gh run view 26170328264 --repo BleedingDev/ultramodern.js --json databaseId,workflowName,event,headBranch,headSha,status,conclusion,createdAt,updatedAt,url,jobs
gh run view 26170328264 --repo BleedingDev/ultramodern.js --log
npm view @bleedingdev/modern-js-create@3.2.0-ultramodern.21 dist --json
npm view @bleedingdev/modern-js-create@3.2.0-ultramodern.21 _npmUser _npmOperationalInternal --json
curl -fsSL 'https://registry.npmjs.org/-/npm/v1/attestations/@bleedingdev%2fmodern-js-create@3.2.0-ultramodern.21'
```

External mutation commands used:

```bash
gh api -X PUT repos/BleedingDev/ultramodern.js/vulnerability-alerts --silent
gh api -X PUT repos/BleedingDev/ultramodern.js/automated-security-fixes --silent
printf '%s' '{"wait_timer":0,"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' \
  | gh api -X PUT 'repos/BleedingDev/ultramodern.js/environments/npm-publish' --input -
gh api -X POST 'repos/BleedingDev/ultramodern.js/environments/npm-publish/deployment-branch-policies' -f name='main-ultramodern'
```
