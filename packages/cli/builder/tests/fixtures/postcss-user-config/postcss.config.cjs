const markerPlugin = () => ({
  postcssPlugin: 'test-marker-user-plugin',
});
markerPlugin.postcss = true;

module.exports = {
  plugins: [markerPlugin],
};
