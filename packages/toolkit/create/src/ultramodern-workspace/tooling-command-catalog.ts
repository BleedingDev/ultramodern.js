export type GeneratedToolingCommandId =
  | 'validate'
  | 'typecheck'
  | 'mfTypes'
  | 'publicSurface'
  | 'backendFederationGenerate'
  | 'backendFederationProof'
  | 'cloudflareProof'
  | 'cloudflareOutputVerify'
  | 'performanceReadiness'
  | 'migrateStrictEffect'
  | 'routesGenerate';

export type GeneratedToolingCommandKey = GeneratedToolingCommandId;

interface GeneratedToolingCommand {
  id: GeneratedToolingCommandId;
  command: string;
  wrapperName: string;
  wrapperPath: `scripts/${string}.mts`;
  contractKey: string;
  rootScript?: string;
  templatePath?: `templates/workspace-scripts/${string}.mjs`;
  cwd?: 'invocation';
}

const defineToolingCommand = (
  command: Omit<GeneratedToolingCommand, 'wrapperPath'>,
): GeneratedToolingCommand => ({
  ...command,
  wrapperPath: `scripts/${command.wrapperName}.mts`,
});

export const generatedToolingCommands = [
  defineToolingCommand({
    id: 'validate',
    command: 'validate',
    wrapperName: 'validate-ultramodern-workspace',
    contractKey: 'validate',
    rootScript: 'contract:check',
  }),
  defineToolingCommand({
    id: 'typecheck',
    command: 'typecheck',
    wrapperName: 'ultramodern-typecheck',
    contractKey: 'typecheck',
    rootScript: 'typecheck',
    templatePath: 'templates/workspace-scripts/ultramodern-typecheck.mjs',
    cwd: 'invocation',
  }),
  defineToolingCommand({
    id: 'mfTypes',
    command: 'mf-types',
    wrapperName: 'assert-mf-types',
    contractKey: 'mfTypes',
    rootScript: 'mf:types',
  }),
  defineToolingCommand({
    id: 'publicSurface',
    command: 'public-surface',
    wrapperName: 'generate-public-surface-assets',
    contractKey: 'publicSurface',
    templatePath:
      'templates/workspace-scripts/generate-public-surface-assets.mjs',
  }),
  defineToolingCommand({
    id: 'backendFederationGenerate',
    command: 'backend-federation-generate',
    wrapperName: 'generate-node-backend-federation',
    contractKey: 'backendFederationGenerate',
    rootScript: 'node:backend-federation:generate',
    templatePath:
      'templates/workspace-scripts/generate-node-backend-federation.mjs',
  }),
  defineToolingCommand({
    id: 'backendFederationProof',
    command: 'backend-federation-proof',
    wrapperName: 'proof-node-backend-federation',
    contractKey: 'backendFederationProof',
    rootScript: 'node:proof',
    templatePath:
      'templates/workspace-scripts/proof-node-backend-federation.mjs',
  }),
  defineToolingCommand({
    id: 'cloudflareProof',
    command: 'cloudflare-proof',
    wrapperName: 'proof-cloudflare-version',
    contractKey: 'cloudflareProof',
    rootScript: 'cloudflare:proof',
    templatePath: 'templates/workspace-scripts/proof-cloudflare-version.mjs',
  }),
  defineToolingCommand({
    id: 'cloudflareOutputVerify',
    command: 'cloudflare-output-verify',
    wrapperName: 'verify-cloudflare-output',
    contractKey: 'cloudflareOutputVerify',
    rootScript: 'cloudflare-output:verify',
  }),
  defineToolingCommand({
    id: 'performanceReadiness',
    command: 'performance-readiness',
    wrapperName: 'ultramodern-performance-readiness',
    contractKey: 'performanceReadiness',
    rootScript: 'performance:readiness',
    templatePath:
      'templates/workspace-scripts/ultramodern-performance-readiness.mjs',
  }),
  defineToolingCommand({
    id: 'migrateStrictEffect',
    command: 'migrate-strict-effect',
    wrapperName: 'migrate-strict-effect',
    contractKey: 'migrateStrictEffect',
    rootScript: 'migrate:strict-effect',
  }),
  defineToolingCommand({
    id: 'routesGenerate',
    command: 'routes-generate',
    wrapperName: 'generate-tanstack-routes',
    contractKey: 'routesGenerate',
  }),
] as const satisfies readonly GeneratedToolingCommand[];

const toolingCommandById = Object.fromEntries(
  generatedToolingCommands.map(command => [command.id, command]),
) as Record<GeneratedToolingCommandId, GeneratedToolingCommand>;

export const GENERATED_TOOLING_COMMANDS = toolingCommandById;

export const generatedToolingCommandList = () =>
  generatedToolingCommands.map(command => command.command);

const createToolingWrapperContract = () =>
  Object.fromEntries(
    generatedToolingCommands.map(command => [
      command.contractKey,
      command.wrapperPath,
    ]),
  ) as Record<
    GeneratedToolingCommandKey,
    GeneratedToolingCommand['wrapperPath']
  >;

export const createGeneratedToolingWrapperMap = createToolingWrapperContract;
