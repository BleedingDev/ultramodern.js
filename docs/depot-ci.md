# Depot CI sponsorship

[Depot](https://depot.dev) sponsors Ultramodern.js CI infrastructure. The logos in
[`assets/sponsors`](../assets/sponsors) come from Depot's
[official brand assets](https://depot.dev/about/brand-assets) and are unchanged.

## Linux on Depot CI

The nine workflows in [`.depot/workflows`](../.depot/workflows) run Linux unit
tests, integration tests, builder tests, lint, type checks, dependency checks,
native compatibility checks, workflow security, and cache seeds. They use
`depot-ubuntu-24.04-8`. Integration keeps all six core shards, both generator
suites, the adapter suite, and the utility suite.

Connect the repository with the Depot Code Access GitHub App. Confirm that
Depot has disabled billing for the sponsored organization before running jobs
or merging these workflows into the default branch. Test the migration with
`depot ci run --workflow .depot/workflows/workflow-security.yml --repo <owner>/ultramodern.js --org 882f0kcw25`.

The GitHub workflows remain active during validation. Their required checks
are pinned to the GitHub Actions app, so Depot's own checks cannot replace them
directly. External fork pull requests also need the GitHub path because
[Depot CI does not yet support them](https://depot.dev/docs/ci/compatibility).
GitHub reusable workflows remain available to release jobs.

[`scripts/ci/run-depot-workflow.mjs`](../scripts/ci/run-depot-workflow.mjs)
provides a bridge for a GitHub job to request a Depot workflow at its exact
commit. It requires `DEPOT_TOKEN` and the GitHub Actions repository, repository
ID, SHA, and ref environment variables. It checks the returned organization,
repository, commit, workflow, and all job results before succeeding, and cancels
its own run on failure or timeout. Validate the API response and matrix coverage
with a live run before replacing any required GitHub job's compute steps with
the bridge. The bridge is not wired into automatic workflows yet.

## Windows, macOS, and GitHub-only jobs

Depot GitHub Actions runners require an organization-owned GitHub repository.
Connect that organization through Depot's **GitHub Actions** page, install the
Depot GitHub App for this repository, and allow public repositories in the
organization's Actions runner group. Confirm that Depot has disabled billing
for the sponsored Depot organization before enabling the runners.

Set these GitHub repository variables:

| Variable | Value |
| --- | --- |
| `DEPOT_LINUX_RUNNER` | `depot-ubuntu-24.04-8` |
| `DEPOT_WINDOWS_RUNNER` | `depot-windows-2025-8` |
| `DEPOT_MACOS_RUNNER` | `depot-macos-26` |

GitHub workflows select these runners for builds, tests, docs, cache seeds, and
release preparation. Depot CI workflows use their fixed Linux runner directly.
Without these variables, GitHub workflows use GitHub-hosted runners.
The existing `SELF_LINUX_LABELS` and `BLEEDINGDEV_ACCEPT_RUNNER_LABELS` overrides
still work when `DEPOT_LINUX_RUNNER` is unset.

Two jobs, `publish` and `publish-sidecars`, always use GitHub's `ubuntu-24.04`.
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) requires
GitHub-hosted runners. The boundary check for external pull requests also stays
on GitHub-hosted compute, selected by the trusted base workflow.

Release dispatches require both the actor and the triggering actor to be the
maintainer `BleedingDev`, including after organization ownership changes.
The release tooling accepts the two exact repository paths and verifies the
permanent GitHub repository ID `1151231350`. Historical npm provenance also
requires that signed repository ID. Package metadata follows the verified active
repository path before and after the transfer.

Before transferring the repository to `ultramodernjs`, add each existing npm
package's new trusted publisher alongside its old connection. Keep the
`npm-publish` environment and `publish-bleedingdev.yml` workflow file name.
New unvalidated connections expire after 48 hours, so add or refresh them when
the transfer and next publish are ready. Existing validated connections remain
in place. A future short npm scope needs a separate organization and new package
names because npm organizations cannot be renamed.

Run **Workflow Security**, Linux, Windows, macOS, and integration tests after
activation. Run **CI Cache** on `main-ultramodern` to seed the new runner caches.
Delete the three runner variables to return to GitHub-hosted compute.

## Compare CI times

Use the same commit, toolchain, test coverage, and workflow on both providers.
Record queue time, each job's duration, and total time until required checks
finish. Compare cold caches separately from repeated warm runs, and link the
public runs with the results. A completed Depot comparison is pending activation.

See Depot's [runner setup guide](https://depot.dev/docs/github-actions/quickstart)
and [runner types](https://depot.dev/docs/github-actions/runner-types), plus the
[Depot CI setup guide](https://depot.dev/docs/ci/quickstart).
