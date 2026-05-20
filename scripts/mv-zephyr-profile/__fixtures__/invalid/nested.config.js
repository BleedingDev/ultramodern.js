const { appTools } = require('@modern-js/app-tools');
const { withZephyr } = require('zephyr-modernjs-plugin');

module.exports = withZephyr(appTools({ bundler: 'rspack' }));
