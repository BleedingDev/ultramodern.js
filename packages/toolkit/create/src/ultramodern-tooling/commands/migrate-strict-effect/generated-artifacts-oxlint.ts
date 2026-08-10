import fs from 'node:fs';
import path from 'node:path';
import { type MigrationIo } from './io';

const functionStyleRule = `    'func-style': [
      'error',
      'declaration',
      {
        allowArrowFunctions: true,
      },
    ],`;

const componentStyleRule = `    'react/function-component-definition': [
      'error',
      {
        namedComponents: ['function-declaration', 'arrow-function'],
      },
    ],`;

const componentStyleRules = `  rules: {
${functionStyleRule}
${componentStyleRule}
  },`;

const hasFunctionStyleRule = (source: string) =>
  /['"]func-style['"]/u.test(source);

const hasComponentStyleRule = (source: string) =>
  /['"]react\/function-component-definition['"]/u.test(source);

const rulesAnchor = /^ {2}rules:\s*\{[ \t]*$/mu;

const legacyComponentStyleRules = `  rules: {
    'react/function-component-definition': [
      'error',
      {
        namedComponents: ['function-declaration', 'arrow-function'],
      },
    ],
  },`;

export function ensureGeneratedOxlintComponentStyle(io: MigrationIo) {
  const configPath = path.join(io.workspaceRoot, 'oxlint.config.ts');
  if (!fs.existsSync(configPath)) {
    return false;
  }

  const source = fs.readFileSync(configPath, 'utf-8');
  const hasFunctionStyle = hasFunctionStyleRule(source);
  const hasComponentStyle = hasComponentStyleRule(source);
  if (hasFunctionStyle && hasComponentStyle) {
    return false;
  }

  const warnUnparseable = () => {
    const message =
      'Could not update oxlint.config.ts component style policy automatically; regenerate the framework-owned config.';
    if (io.dryRun) {
      io.log(message);
    } else {
      process.stderr.write(`[ultramodern] ${message}\n`);
    }
  };

  if (hasComponentStyle && !hasFunctionStyle) {
    if (!source.includes(legacyComponentStyleRules)) {
      warnUnparseable();
      return false;
    }
    return io.write(
      configPath,
      source.replace(rulesAnchor, match => `${match}\n${functionStyleRule}`),
    );
  }

  if (/^[ \t]*rules\s*:/mu.test(source)) {
    warnUnparseable();
    return false;
  }

  const extendsAnchor = /^ {2}extends:\s*\[\s*core\s*,\s*react\s*\],[ \t]*$/mu;
  if (!extendsAnchor.test(source)) {
    warnUnparseable();
    return false;
  }

  return io.write(
    configPath,
    source.replace(extendsAnchor, match => `${match}\n${componentStyleRules}`),
  );
}
