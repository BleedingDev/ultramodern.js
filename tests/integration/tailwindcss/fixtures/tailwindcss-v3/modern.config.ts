import { pluginBabel } from '@rsbuild/plugin-babel';
import { applyBaseConfig } from '../../../../utils/applyBaseConfig';

export default applyBaseConfig({
  builderPlugins: [
    pluginBabel({
      parallel: true,
      babelLoaderOptions: {
        plugins: [
          [
            'babel-plugin-macros',
            {
              twin: {
                preset: 'styled-components',
                config: './tailwind.config.js',
              },
            },
          ],
        ],
      },
    }),
  ],
});
