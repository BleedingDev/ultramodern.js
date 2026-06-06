import { runOxlintRules } from './oxlint';

type SingleAppI18nCheckOptions = {
  readonly cwd?: string;
  readonly targets?: readonly string[];
};

export const runSingleAppI18nCheck = ({
  cwd = process.cwd(),
  targets = ['src'],
}: SingleAppI18nCheckOptions = {}): number => {
  const exitCode = runOxlintRules({
    cwd,
    targets,
    rules: {
      'ultramodern/no-hardcoded-jsx-text': 'error',
      'ultramodern/no-literal-visible-jsx-attributes': 'error',
    },
  });

  if (exitCode === 0) {
    console.log('No hardcoded user-visible JSX strings found.');
  }

  return exitCode;
};

export const main = () => {
  process.exitCode = runSingleAppI18nCheck();
};
