import { effectDiagnosticSeverity } from '../src/ultramodern-workspace/effect-diagnostics';
import { createTsConfigBase } from '../src/ultramodern-workspace/tsconfigs';

test('generated typechecks reject Effect diagnostics without severity or exit-code exemptions', () => {
  expect(createTsConfigBase()).toMatchObject({
    compilerOptions: {
      plugins: [
        {
          name: '@effect/language-service',
          diagnostics: true,
          includeSuggestionsInTsc: true,
          ignoreEffectSuggestionsInTscExitCode: false,
          ignoreEffectWarningsInTscExitCode: false,
          ignoreEffectErrorsInTscExitCode: false,
          diagnosticSeverity: {
            floatingEffect: 'error',
            experimentalApiUsage: 'error',
            unstableApiUsage: 'error',
          },
        },
      ],
    },
  });
  expect(new Set(Object.values(effectDiagnosticSeverity))).toEqual(
    new Set(['error']),
  );
});
