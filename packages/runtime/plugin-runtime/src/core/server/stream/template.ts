// @effect-diagnostics asyncFunction:off
import {
  type BuildShellAfterTemplateOptions,
  buildShellAfterTemplate,
} from './afterTemplate';
import {
  type BuildShellBeforeTemplateOptions,
  buildShellBeforeTemplate,
} from './beforeTemplate';

export type InjectTemplate = {
  shellBefore: string;
  shellAfter: string;
};

const HTML_SEPARATOR = '<!--<?- html ?>-->';

type GetTemplatesOptions = BuildShellAfterTemplateOptions &
  BuildShellBeforeTemplateOptions;

export const getTemplates = async (
  htmlTemplate: string,
  options: GetTemplatesOptions,
): Promise<InjectTemplate> => {
  const builtTemplate = await buildShellAfterTemplate(htmlTemplate, options);
  const [beforeAppTemplate = '', afterAppHtmlTemplate = ''] =
    builtTemplate.split(HTML_SEPARATOR) || [];

  const builtBeforeTemplate = await buildShellBeforeTemplate(
    beforeAppTemplate,
    options,
  );

  return {
    shellBefore: builtBeforeTemplate,
    shellAfter: afterAppHtmlTemplate,
  };
};
