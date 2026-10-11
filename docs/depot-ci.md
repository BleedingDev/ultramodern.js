# Depot CI sponsorship

[Depot](https://depot.dev) sponsors Ultramodern.js CI infrastructure. The logos in
[`assets/sponsors`](../assets/sponsors) come from Depot's
[official brand assets](https://depot.dev/about/brand-assets) and are unchanged.

## Linux on Depot CI

The nine automatic workflows in [`.depot/workflows`](../.depot/workflows) run Linux unit
tests, integration tests, builder tests, lint, type checks, dependency checks,
native compatibility checks, workflow security, and cache seeds. They use
`depot-ubuntu-24.04-8`. Integration keeps all six core shards, both generator
suites, the adapter suite, and the utility suite.
The separate `ci-benchmark.yml` workflow runs only when requested for a comparison.

Connect the repository with the Depot Code Access GitHub App. Depot offers a
[seven-day trial without a credit card](https://depot.dev/docs/ci/overview).
Limited validation can use that trial after the account page confirms it is
active and has enough quota. Wait for Pedro to confirm billing is disabled for
organization `882f0kcw25` before permanent activation or merging these workflows
into the default branch.

After verifying the API token and organization configuration, validate a frozen,
committed SHA from a GitHub Actions job with
`node scripts/ci/run-depot-workflow.mjs .depot/workflows/workflow-security.yml`.
The job's GitHub environment must identify that exact repository and SHA. The
Depot CLI can submit local workflow content and workspace patches, so a CLI
preflight alone does not prove the committed revision passed a required check.

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

The paired comparison is pending validation. Use verified trial quota for
limited validation, or confirmed sponsored billing after activation, as described
above. Trial availability does not establish that sponsored billing is disabled.

1. Freeze one green commit and run the same Linux workload on both providers:
   unit tests and build consumers, or the ten Linux integration suite jobs. Keep
   the toolchain, lockfile, browser versions, test workers, and commands identical.
   Verify the actual checkout with `record-runner-evidence.mjs`; a pull request's
   `head_sha` can differ from its tested merge commit. Do not compare the whole
   GitHub integration workflow, which also includes Windows jobs, with Linux-only
   Depot CI. Record the workflow revision and exact selected job names.
2. Measure cold and warm caches separately. For cold runs, disable every project
   cache restore and save, or give every cache key **and fallback restore prefix**
   a unique namespace per sample. Include pnpm, toolchain, browser, and prepared
   build caches. Call this "project-cache cold": provider image caches may remain
   warm. For warm runs, seed both providers at the frozen commit and verify hits
   in the logs for every cache used, including prepared-build validation. A fast
   run alone does not prove a hit. The current cache seed writes only from
   `main-ultramodern`; use it when that branch contains the frozen commit, without
   pretending a feature branch is the default branch. Use `mixed` or `unknown`
   when evidence is missing.
3. Collect at least five successful pairs per workload and cache condition.
   Alternate launch order between GitHub first and Depot first, keeping each pair
   close together. Avoid overlapping runs that the workflow's concurrency rule
   would cancel. Keep a ledger of every failure, cancellation, and retry with its
   run link and reason; report these counts alongside the successful sample count.
   Compare first attempts separately from time spent recovering failed runs.
4. Record runner evidence after installing the pinned toolchain:
   `node scripts/ci/record-runner-evidence.mjs "$(pnpm --version)"`. Its
   `CI_BENCHMARK_EVIDENCE` JSON has schema `ultramodern.ci.runner-evidence`, version
   `1`: `checkedOutCommit`, `github` identity and workflow reference, `tools`,
   `runner` OS/CPU/memory/image, and `inputs` lockfile/mise SHA-256 hashes. Keep this
   evidence and cache-hit logs with each run. Observed host hardware may differ
   from allocated container limits; record Depot's requested CPU and memory too.
   `github.workflowRef` is optional observed metadata on Depot; the native run/job
   APIs establish the selected workflow path and committed revision.
5. Collect completed GitHub run attempts with
   `node scripts/ci/collect-ci-timings.mjs --input samples.json --output timings.json`.
   The input contains `repository` and a `samples` array. Each sample identifies
   `runId`, `attempt`, `provider`, `cacheState`, `workload`, verified `testedSha`,
   exact `jobNames`, `cacheEvidence`, and `toolchain`. Provider values are
   `github-actions`, `depot-github-actions`, or `depot-ci`; cache values are
   `cold`, `warm`, `mixed`, or `unknown`. The collector preserves run and job links,
   timestamps, runner labels, conclusions, and missing-evidence issues.

The manual `ci-benchmark.yml` workflows on both providers run matching type-check
and Linux unit/build-consumer jobs with fresh project caches. They disable cache
restores, prepared-build restores, and Nx task caches, and isolate the pnpm store,
mise data, and browser downloads per job. Provider image caches remain outside
this control. GitHub must register the workflow on the default branch before
manual dispatch. These workflows establish cold samples; they do not establish
warm-cache results.

Set `collectEvidence: true` in each sample to extract checkout and runner proof
from its job logs. For native Depot samples, set the input manifest's `source` to
`depot-ci`, provide the exact `workflowPath`, and supply `DEPOT_TOKEN` through the
existing private credential configuration. The collector reads native run, job,
and attempt timestamps. It does not invent step durations or infer cache state.

Report the median and range for job execution, the sum of job execution seconds,
and elapsed time from workflow creation until the selected jobs finish. Report
time until all required checks finish separately. Job creation-to-start includes
dependency and concurrency waits, so label it as waiting time rather than pure
runner queue time. A GitHub bridge to Depot CI measures delivery through GitHub;
use Depot's native run/job timestamps for Depot execution, and keep both metrics.
GitHub reruns can retain the original creation time, so do not treat their elapsed
time as a fresh first-attempt measurement.

The current Linux migration changes GitHub's public `ubuntu-24.04` runner
(4 CPUs, 16 GB RAM) to Depot's `depot-ubuntu-24.04-8` (8 CPUs, 32 GB RAM).
Disclose that hardware change with the result; it measures this migration, not
provider performance at equal hardware. Keep Windows and macOS results separate.
See the [GitHub runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
and [Depot runner specifications](https://depot.dev/docs/github-actions/runner-types).

The [historical GitHub pilot](https://github.com/BleedingDev/ultramodern.js/actions/runs/38171642118)
is uncontrolled: its commit and cache state do not establish a paired baseline.
It cannot support a before/after speedup claim. Publish results only with the
paired run links, tested commit, cache and runner evidence, selected job coverage,
and complete failure/retry ledger. No Depot speedup has been measured yet.

See Depot's [runner setup guide](https://depot.dev/docs/github-actions/quickstart)
and [runner types](https://depot.dev/docs/github-actions/runner-types), plus the
[Depot CI setup guide](https://depot.dev/docs/ci/quickstart).
