import type {
  Collector,
  RuntimePlugin,
  SSRRenderInfo,
  SSRRenderLifecycle,
  StreamSSRExtender,
} from '@modern-js/plugin/runtime';
import {
  abortHeadRender,
  beginHeadRender,
  completeHeadRender,
  createConservingWebShellStream,
  publishHeadRender,
} from '@modern-js/runtime-extensions';
import { projectRuntimeContext } from '@modern-js/runtime-extensions/context-projection';
import { createHeadRuntime } from '@modern-js/runtime-extensions/head-runtime';
import { ensureHelmetContext } from '@modern-js/runtime-extensions/helmet-context';
import React from 'react';
import { createAssetPolicy } from './assetPolicy';
import { createTemplatePolicy } from './templatePolicy';

export type RendererHeadPluginOptions = {
  processNodeStream?: (
    source: NodeJS.ReadWriteStream,
    context: object,
    terminalMarker: string,
  ) => NodeJS.ReadWriteStream;
};

export function createRendererHeadPlugin(
  options: RendererHeadPluginOptions = {},
): RuntimePlugin<{}> {
  return {
    name: '@modern-js/runtime-renderer-extensions',
    setup(api) {
      const head = createHeadRuntime();
      api.resolveComponent((component, { name }) =>
        name === 'head.Helmet' ? head.Head : component,
      );
      api.transformRuntimeContext(projectRuntimeContext);
      api.wrapRoot(Root => {
        const HeadRoot = (props: React.ComponentProps<typeof Root>) =>
          // A root is only defined once the plugin that owns it (the router,
          // for a file-system routes entry) has run. This plugin must keep
          // working when it is registered before that one: it then wraps the
          // children the later plugin hands it instead of a missing root.
          head.wrapClientRoot(
            Root
              ? React.createElement(Root, props)
              : ((props as { children?: React.ReactNode })?.children ?? null),
          );
        return HeadRoot;
      });

      const createState = ({ runtimeContext, monitors }: SSRRenderInfo) => {
        const helmetContext = ensureHelmetContext(runtimeContext);
        const reportLateHead =
          process.env.NODE_ENV === 'production'
            ? (message: string) => monitors.warn(message)
            : (message: string) => monitors.error(message);
        const lifecycle: SSRRenderLifecycle = {
          beforeReact() {
            beginHeadRender(runtimeContext, reportLateHead);
          },
          completedBody(html, { phase }) {
            if (phase === 'complete') {
              return completeHeadRender(runtimeContext, html);
            }
            publishHeadRender(runtimeContext);
            return html;
          },
          getHeadData() {
            return helmetContext.helmet ?? undefined;
          },
          onTerminal(terminal) {
            if (terminal.status !== 'complete') abortHeadRender(runtimeContext);
          },
        };
        return {
          lifecycle,
          wrap(root: React.ReactNode) {
            return head.wrapServerRoot(root, { runtimeContext, helmetContext });
          },
        };
      };

      api.extendStringSSRCollectors(({ render }): Collector => {
        const state = createState(render);
        return {
          ...state.lifecycle,
          ...createAssetPolicy(render),
          ...createTemplatePolicy(render),
          collect: state.wrap,
          effect() {},
        };
      });
      api.extendStreamSSR((info): StreamSSRExtender => {
        const { runtimeContext, terminalMarker } = info;
        const processNodeStream = options.processNodeStream;
        if (info.platform === 'node' && processNodeStream === undefined) {
          throw new Error(
            'Node head rendering requires the Node runtime-renderer-extensions entry',
          );
        }
        const state = createState(info);
        return {
          ...state.lifecycle,
          ...createAssetPolicy(info),
          ...createTemplatePolicy(info),
          modifyRootElement: state.wrap,
          streamPhase: 'body',
          processStream:
            processNodeStream === undefined
              ? undefined
              : source =>
                  processNodeStream(source, runtimeContext, terminalMarker),
          processReadableStream: source =>
            createConservingWebShellStream(
              source,
              runtimeContext,
              terminalMarker,
            ),
        };
      });
    },
  };
}

/**
 * The plugins whose root this one wraps. Declaring them keeps the head
 * provider outside their trees no matter what order the CLI emitted the
 * runtime descriptors in.
 */
export const RENDERER_HEAD_PRE_PLUGINS = [
  '@modern-js/plugin-router',
  '@modern-js/plugin-tanstack',
  '@modern-js/plugin-state',
  '@modern-js/plugin-i18n',
];

export const rendererHeadPlugin = (): RuntimePlugin<{}> => ({
  ...createRendererHeadPlugin(),
  pre: RENDERER_HEAD_PRE_PLUGINS,
});

export default rendererHeadPlugin;
