const { appTools } = require('@modern-js/app-tools');
const { withZephyr } = require('zephyr-rspack-plugin');

module.exports = withZephyr(appTools());
