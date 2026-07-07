export const migrateStrictEffectHelp = `Usage:
  modern-js-create ultramodern migrate-strict-effect --version <version> [--dry-run] [--skip-install]

Updates generated UltraModern package-source metadata, Modern package aliases,
framework-owned toolchain pins, direct Effect API topology metadata, strict
Effect pnpm overrides/trust policy, framework-owned TypeScript config
surfaces, and the pnpm lockfile. Source code still has to pass pnpm api:check
and pnpm contract:check.

When the compact config is absent but legacy UltraModern 3.2 metadata is
present, the compact config is synthesized from it first. Shell-only
workspaces skip the backend-federation and Zerops runtime stages. Pass
--dry-run to print the planned filesystem changes without writing anything
(implies --skip-install).
`;
