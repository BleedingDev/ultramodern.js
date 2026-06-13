import { pluginSass } from '@rsbuild/plugin-sass';
import { defineConfig } from '@rspress/core';
import { transformerNotationHighlight } from '@shikijs/transformers';
import path from 'path';
import { pluginOpenGraph } from 'rsbuild-plugin-open-graph';

const docPath = path.join(__dirname, 'docs');
const staticPath = path.join(__dirname, 'static');
const siteTitle = 'UltraModern.js 3.0';
const siteDescription =
  'UltraModern.js 3.0 is a SuperApp framework forked from Modern.js for Effect, TanStack Router, SSR, BFF, and independently deployable Micro Verticals.';
const socialDescription =
  'A SuperApp framework for Effect, TanStack Router, SSR, BFF, and Micro Verticals.';

function normalizeBase(base = '/') {
  const trimmed = base.trim();
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/')
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
}

// Set by CI for GitHub Pages project sites. Defaults to root for local dev/custom domains.
const docsBase = normalizeBase(process.env.DOCS_BASE);
const docsOrigin = (
  process.env.DOCS_ORIGIN || 'https://bleedingdev.github.io'
).replace(/\/+$/, '');
const siteUrl = new URL(docsBase, `${docsOrigin}/`).toString();
const socialImage = new URL('img/social-card.svg', siteUrl).toString();
const faviconUrl = new URL('img/favicon.ico', siteUrl).toString();
const docsAsset = (assetPath: string) =>
  `${docsBase}${assetPath.replace(/^\//, '')}`;

export default defineConfig({
  root: docPath,
  llms: true,
  title: siteTitle,
  description: siteDescription,
  base: docsBase,
  logo: docsAsset('/img/logo.svg'),
  icon: faviconUrl,
  lang: 'en',
  themeDir: path.join(__dirname, 'src'),
  markdown: {
    checkDeadLinks: true,
    shiki: {
      transformers: [transformerNotationHighlight()],
    },
  },
  search: {
    codeBlocks: true,
  },
  // head: [
  //   () => {
  //     return [
  //       `<meta property="og:image" content="${socialImage}">`,
  //       `<meta property="og:description" content="${socialDescription}">`,
  //       `<meta property="og:image:alt" content="${siteTitle}">`,
  //       `<meta name="twitter:card" content="summary_large_image">`,
  //       `<meta name="twitter:title" content="${siteTitle}">`,
  //       `<meta name="twitter:description" content="${socialDescription}">`,
  //       `<meta name="twitter:image" content="${socialImage}">`,
  //       `<meta name="twitter:image:alt" content="${siteTitle}">`,
  //     ].join('');
  //   },
  // ],
  themeConfig: {
    locales: [
      {
        lang: 'zh',
        title: siteTitle,
        description: socialDescription,
        // nav: getNavbar('zh'),
        label: '简体中文',
      },
      {
        lang: 'en',
        title: siteTitle,
        description: socialDescription,
        // nav: getNavbar('en'),
        label: 'English',
      },
    ],
    editLink: {
      docRepoBaseUrl:
        'https://github.com/BleedingDev/ultramodern.js/tree/main-ultramodern/packages/document/docs',
      text: 'Edit this page on GitHub',
    },
    socialLinks: [
      {
        icon: 'discord',
        mode: 'link',
        content: 'https://discord.gg/qPCqYg38De',
      },
      {
        icon: 'github',
        mode: 'link',
        content: 'https://github.com/BleedingDev/ultramodern.js',
      },
    ],
  },
  route: {
    // exclude document fragments from routes
    exclude: ['scripts/**', '**/zh/components/**', '**/en/components/**'],
  },
  replaceRules: [
    {
      // Preserve the upstream replacement contract for inherited docs.
      search: /MAJOR_VERSION/g,
      replace: '2',
    },
  ],
  builderConfig: {
    performance: {
      buildCache: false,
    },
    tools: {
      // FIXME: use `?raw` after upgrading to Rsbuild@1.4.0, https://github.com/web-infra-dev/rsbuild/pull/5355
      rspack(_config, { addRules }) {
        addRules([
          {
            test: /\.txt$/i,
            type: 'asset/source',
          },
        ]);
      },
    },
    output: {
      dataUriLimit: 0,
    },
    server: {
      publicDir: {
        name: staticPath,
      },
    },
    dev: {
      lazyCompilation: process.env.LAZY !== 'false',
    },
    resolve: {
      alias: {
        '@site-docs': path.join(__dirname, './docs/zh'),
        '@site-docs-en': path.join(__dirname, './docs/en'),
        '@site': require('path').resolve(__dirname),
      },
    },
    plugins: [
      pluginSass(),
      pluginOpenGraph({
        // Note, title is page-specific
        title: 'UltraModern.js 3.0 Home Page',
        // While site name is site wide
        siteName: siteTitle,
        type: 'website',
        url: siteUrl,
        image: socialImage,
        description: socialDescription,
        twitter: {
          site: '@BleedingDev',
          card: 'summary_large_image',
        },
      }),
    ],
  },
});
