const { appTools } = require('@modern-js/app-tools');
const { withZephyr } = require('@modern-js/plugin-zephyr');

module.exports = appTools(withZephyr({ runtime: {} }));
