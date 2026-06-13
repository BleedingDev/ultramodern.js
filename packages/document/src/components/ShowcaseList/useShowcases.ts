import { withBase } from '@rspress/core/runtime';

export type ShowcaseType = 'framework' | 'builder' | 'doc' | 'module';

export type ShowcaseItem = {
  url: string;
  name: string;
  preview: string;
  type: ShowcaseType;
};

export const useShowcases = (): ShowcaseItem[] => {
  const preview = (name: string) => withBase(`/img/features/${name}.svg`);

  return [
    {
      name: 'UltraModern.js',
      url: 'https://bleedingdev.github.io/ultramodern.js/',
      preview: preview('framework'),
      type: 'framework',
    },
    {
      name: 'Effect',
      url: 'https://effect.website/',
      preview: preview('api'),
      type: 'framework',
    },
    {
      name: 'TanStack Router',
      url: 'https://tanstack.com/router',
      preview: preview('url'),
      type: 'framework',
    },
    {
      name: 'Rspack',
      url: 'https://rspack.rs/',
      preview: preview('compiler'),
      type: 'builder',
    },
    {
      name: 'Rspress',
      url: 'https://rspress.rs/',
      preview: preview('visual'),
      type: 'doc',
    },
    {
      name: 'Modern.js',
      url: 'https://modernjs.dev/en/',
      preview: preview('app'),
      type: 'doc',
    },
    {
      name: 'Module Federation',
      url: 'https://module-federation.io/',
      preview: preview('frameworks'),
      type: 'module',
    },
  ];
};
