import { printOxlintOutput, runOxlintRules } from './oxlint';

type SingleAppI18nCheckOptions = {
  readonly cwd?: string;
  readonly targets?: readonly string[];
};

const SINGLE_APP_I18N_SUCCESS = 'No hardcoded user-visible JSX strings found.';

const SINGLE_APP_I18N_FAILURE =
  'Hardcoded user-visible JSX strings found. Move copy to locale JSON files.';

export const runSingleAppI18nCheck = ({
  cwd = process.cwd(),
  targets = ['src'],
}: SingleAppI18nCheckOptions = {}): number => {
  const result = runOxlintRules({
    cwd,
    targets,
    rules: {
      'ultramodern/no-hardcoded-jsx-text': 'error',
      'ultramodern/no-literal-visible-jsx-attributes': 'error',
    },
  });

  if (result.exitCode === 0) {
    console.log(SINGLE_APP_I18N_SUCCESS);
    return 0;
  }

  console.error(SINGLE_APP_I18N_FAILURE);
  printOxlintOutput(result);
  return result.exitCode;
};

export const main = (): void => {
  process.exitCode = runSingleAppI18nCheck();
};
