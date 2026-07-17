import type { StorybookConfig } from 'storybook-react-rsbuild';

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-onboarding',
    '@storybook/addon-docs',
    {
      name: 'storybook-addon-modernjs',
      options: {},
    },
  ],
  framework: 'storybook-react-rsbuild',
  typescript: {
    reactDocgen: false,
    check: false,
  },
};

export default config;
