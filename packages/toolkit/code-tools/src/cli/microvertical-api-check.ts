import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  checkMicroVerticalApiBoundaries,
  checkMicroVerticalApiConsumerFiles,
  type MicroVerticalApiSourceRule,
} from '../microvertical-api-boundary';

const flags = ['--workspace-root', '--baseline-package-directory', '--rules'];

/** A rules module default-exports an array of source rule functions. */
async function loadSourceRules(
  file: string,
): Promise<readonly MicroVerticalApiSourceRule[]> {
  const rules: unknown = (
    await import(
      /* webpackIgnore: true */ pathToFileURL(path.resolve(file)).href
    )
  ).default;
  if (!Array.isArray(rules) || !rules.every(rule => typeof rule === 'function'))
    throw new Error(
      `${file}: default export must be an array of source rule functions, e.g. \`export default [myRule]\``,
    );
  return rules;
}

export async function runMicroVerticalApiCheckCli(
  args = process.argv.slice(2),
  filesOnly = false,
): Promise<number> {
  let workspaceRoot = process.env.ULTRAMODERN_WORKSPACE_ROOT ?? process.cwd();
  let baselinePackageDirectory: string | undefined;
  const ruleFiles: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      console.log(
        `${filesOnly ? 'modern-api-check-files' : 'modern-api-check'} [--workspace-root <path>] [--baseline-package-directory <path>] [--rules <module>]...\n${filesOnly ? 'Checks consumer files, contracts, package exports and owner identity. Does not analyze runtime topology; run the strict Effect source phase separately.' : 'Checks consumer files, contracts, package exports, owner identity and runtime topology once per API entry.'}\n--rules loads a module whose default export is an array of source rules; each rule runs once per workspace source file with the shared module graph.\nWorkspace defaults to ULTRAMODERN_WORKSPACE_ROOT then cwd. Exit codes: 0 valid, 1 consumer violation, 2 tool/configuration failure.`,
      );
      return 0;
    }
    if (
      !flags.includes(argument ?? '') ||
      !args[index + 1] ||
      args[index + 1]?.startsWith('--')
    ) {
      console.error(`Invalid argument: ${argument ?? ''}. Use --help.`);
      return 2;
    }
    const value = args[++index]!;
    if (argument === '--workspace-root') workspaceRoot = value;
    else if (argument === '--rules') ruleFiles.push(value);
    else baselinePackageDirectory = value;
  }
  const sourceRules: MicroVerticalApiSourceRule[] = [];
  for (const file of ruleFiles)
    try {
      sourceRules.push(...(await loadSourceRules(file)));
    } catch (error) {
      console.error(
        `API tool error: --rules ${error instanceof Error ? error.message : String(error)}`,
      );
      return 2;
    }
  const result = (
    filesOnly
      ? checkMicroVerticalApiConsumerFiles
      : checkMicroVerticalApiBoundaries
  )({ workspaceRoot, baselinePackageDirectory, sourceRules });
  for (const diagnostic of result.diagnostics)
    console.error(`API violation: ${diagnostic}`);
  for (const error of result.toolErrors)
    console.error(`API tool error: ${error}`);
  if (result.toolErrors.length) return 2;
  if (result.diagnostics.length) return 1;
  console.log(
    `UltraModern API ${filesOnly ? 'consumer files' : 'boundary'} check passed.`,
  );
  return 0;
}
