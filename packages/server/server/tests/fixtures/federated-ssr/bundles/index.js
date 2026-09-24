// A dev SSR bundle as Module Federation emits it: every evaluation is a new
// bundle generation that initialises the `host` container and provides
// `react` from its own module graph.
const { init } = require('@module-federation/runtime');

const react = { generation: Symbol('react') };

const federation = init({
  name: 'host',
  remotes: [],
  shared: {
    react: {
      version: '19.0.0',
      lib: () => react,
      shareConfig: { singleton: true, requiredVersion: '^19.0.0' },
    },
  },
});

module.exports = {
  react,
  // Consumers get a module factory from the share scope, as bundles do.
  loadReact: () => federation.loadShareSync('react')(),
};
