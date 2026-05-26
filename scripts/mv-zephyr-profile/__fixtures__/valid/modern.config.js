const { appTools, defineConfig } = require('@modern-js/app-tools');
const { withZephyr } = require('zephyr-rspack-plugin');

const zephyrRspackPlugin = () => ({
  name: 'zephyr-rspack-bridge',
  setup(api) {
    api.modifyRspackConfig(config => withZephyr()(config));
  },
});

module.exports = defineConfig({
  output: {
    distPath: {
      html: './',
    },
  },
  html: {
    outputStructure: 'flat',
  },
  source: {
    mainEntryName: 'index',
  },
  plugins: [appTools(), zephyrRspackPlugin()],
});
