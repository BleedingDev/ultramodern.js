const { appTools, defineConfig } = require('@modern-js/app-tools');
const { withZephyr } = require('zephyr-modernjs-plugin');

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
  plugins: [
    appTools({
      bundler: 'rspack',
    }),
    withZephyr(),
  ],
});
