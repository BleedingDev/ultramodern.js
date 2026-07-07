import {
  getSourceText,
  isApiEntryFile,
  isApiSourceFile,
  isForbiddenGeneratedEffectPath,
  isSharedApiContractFile,
  normalizeFilename,
  reportMissingProgramPattern,
  reportProgramPattern,
} from '../ast.ts';
import type { Rule } from '../types.ts';

export const createStrictEffectApiBoundariesRule = (): Rule => ({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw HTTP handlers and non-Effect API runtime drift in UltraModern workspaces.',
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        const source = getSourceText(context, node);
        const filename = normalizeFilename(context.filename);
        const apiFile = isApiSourceFile(filename);

        if (isForbiddenGeneratedEffectPath(filename)) {
          context.report({
            node,
            message:
              'Generated UltraModern workspaces use direct api/index.ts, shared/api.ts and src/api/* paths; api/effect, api/lambda, shared/effect and src/effect are forbidden.',
          });
        }

        reportProgramPattern(
          context,
          node,
          source,
          /@modern-js\/plugin-bff\/hono-server/u,
          'UltraModern API workspaces must not import Hono server helpers; use @modern-js/plugin-bff/effect-edge and HttpApi.',
        );
        reportProgramPattern(
          context,
          node,
          source,
          /\bruntimeFramework\s*(?::|=)\s*['"]hono['"]/u,
          'UltraModern API apps must use bff.runtimeFramework: "effect".',
        );
        reportProgramPattern(
          context,
          node,
          source,
          /(?:from|import)\s*['"][^'"]*(?:api\/effect|shared\/effect)[^'"]*['"]|shared-effect-api/u,
          'Import API code from direct api/index.ts, shared/api.ts or src/api/* paths, not api/effect, shared/effect or shared Effect API packages.',
        );
        reportProgramPattern(
          context,
          node,
          source,
          /\bstrictEffectApproach\s*(?::|=)\s*false\b/u,
          'UltraModern API apps must keep strictEffectApproach enabled.',
        );

        if (isApiEntryFile(filename)) {
          reportMissingProgramPattern(
            context,
            node,
            source,
            /\bdefineEffectBff\b/u,
            'Generated API entries must export defineEffectBff(...).',
          );
          reportMissingProgramPattern(
            context,
            node,
            source,
            /\bHttpApiBuilder\b/u,
            'Generated API entries must implement handlers through HttpApiBuilder.',
          );
          reportMissingProgramPattern(
            context,
            node,
            source,
            /\bLayer\b/u,
            'Generated API entries must compose dependencies with Effect Layer.',
          );
          reportMissingProgramPattern(
            context,
            node,
            source,
            /from\s+['"]\.\.\/shared\/api\.ts['"]/u,
            'Generated API entries must import the contract from ../shared/api.ts.',
          );
        }

        if (isSharedApiContractFile(filename)) {
          reportMissingProgramPattern(
            context,
            node,
            source,
            /\bHttpApi\.make\b/u,
            'Generated shared API contracts must declare an HttpApi contract.',
          );
          reportMissingProgramPattern(
            context,
            node,
            source,
            /\bHttpApiGroup\.make\b/u,
            'Generated shared API contracts must declare HttpApi groups.',
          );
          reportMissingProgramPattern(
            context,
            node,
            source,
            /\bHttpApiEndpoint\./u,
            'Generated shared API contracts must declare endpoints through HttpApiEndpoint.',
          );
          reportMissingProgramPattern(
            context,
            node,
            source,
            /\bSchema\./u,
            'Generated shared API contracts must model request, response and error shapes with Schema.',
          );
        }

        if (!apiFile) {
          return;
        }

        reportProgramPattern(
          context,
          node,
          source,
          /\bnew\s+Response\s*\(|\bResponse\.json\s*\(/u,
          'API modules must not hand-build Response objects; model endpoints through Effect HttpApi and schemas.',
        );
        reportProgramPattern(
          context,
          node,
          source,
          /\b(?:request|req)\.(?:json|text|formData|arrayBuffer)\s*\(/u,
          'API modules must not manually parse request bodies; use HttpApiEndpoint payload/query/params schemas.',
        );
        reportProgramPattern(
          context,
          node,
          source,
          /\bexport\s+const\s+handler\b|\bexport\s+default\s+async\b/u,
          'API modules must not export raw request handlers; export defineEffectBff(...) from api/index.ts.',
        );
        reportProgramPattern(
          context,
          node,
          source,
          /\bcreateHandler\s*[:=]\s*(?!defineEffectBff\b)/u,
          'API modules must not define unbranded handler factories; use defineEffectBff(...).',
        );
        reportProgramPattern(
          context,
          node,
          source,
          /\bSchema\.(?:UnknownFromJsonString|Unknown|Any)\b/u,
          'API modules must use concrete request, response and error schemas; Schema.UnknownFromJsonString, Schema.Unknown and Schema.Any are forbidden in UltraModern API code.',
        );
      },
    };
  },
});
