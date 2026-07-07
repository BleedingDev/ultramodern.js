import path from 'node:path';
import readline from 'node:readline';
import { i18n, localeKeys } from '../locale';
import { collectPositionalArgs, LEGACY_MODERN_JS_CONFIRMATION } from './flags';
import { isDirectoryEmpty } from './project-setup';

export function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function confirmLegacyModernJsSetup() {
  console.error('');
  console.error(i18n.t(localeKeys.message.legacyModernJsWarning));
  console.error('');

  const answer = await promptInput(
    i18n.t(localeKeys.prompt.legacyModernJsConfirmation, {
      confirmation: LEGACY_MODERN_JS_CONFIRMATION,
    }),
  );

  if (answer !== LEGACY_MODERN_JS_CONFIRMATION) {
    console.error(i18n.t(localeKeys.error.legacyModernJsNotConfirmed));
    process.exit(1);
  }
}

export async function getProjectName(): Promise<{
  name: string;
  useCurrentDir: boolean;
}> {
  const args = process.argv.slice(2);
  const positionalArgs = collectPositionalArgs(args);

  if (positionalArgs.length > 1) {
    console.error(`Unexpected positional argument: ${positionalArgs[1]}`);
    process.exit(1);
  }

  const projectNameArg = positionalArgs[0];

  if (projectNameArg) {
    if (projectNameArg === '.') {
      return { name: path.basename(process.cwd()), useCurrentDir: true };
    }
    return { name: projectNameArg, useCurrentDir: false };
  }

  // 如果当前目录为空，直接使用当前目录名作为项目名
  const currentDir = process.cwd();
  if (isDirectoryEmpty(currentDir)) {
    return { name: path.basename(currentDir), useCurrentDir: true };
  }

  const projectName = await promptInput(i18n.t(localeKeys.prompt.projectName));

  if (!projectName) {
    console.error(i18n.t(localeKeys.error.projectNameEmpty));
    process.exit(1);
  }

  return { name: projectName, useCurrentDir: false };
}
