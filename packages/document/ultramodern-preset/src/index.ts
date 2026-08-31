import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from '@rspress/core';
import { pluginOpenGraph } from 'rsbuild-plugin-open-graph';

const siteTitle = 'UltraModern.js 3.0';
const siteDescription =
  'UltraModern.js 3.0 is a SuperApp framework forked from Modern.js for Effect, TanStack Router, SSR, BFF, and independently deployable Micro Verticals.';
const socialDescription =
  'A SuperApp framework for Effect, TanStack Router, SSR, BFF, and Micro Verticals.';
const defaultOrigin = 'https://bleedingdev.github.io';
const githubUrl = 'https://github.com/BleedingDev/ultramodern.js';

export const ultraModernDocsAssets = new URL('../assets/', import.meta.url);

export type UltraModernDocsPresetOptions = {
  base?: string;
  origin?: string;
};

const normalizeBase = (base = '/') => {
  const trimmed = base.trim();
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/')
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
};

const asPublicDirectories = (
  publicDir: NonNullable<
    NonNullable<UserConfig['builderConfig']>['server']
  >['publicDir'],
) => {
  if (!publicDir) {
    return [];
  }
  return Array.isArray(publicDir) ? publicDir : [publicDir];
};

export const applyUltraModernDocsPreset = (
  config: UserConfig,
  options: UltraModernDocsPresetOptions = {},
): UserConfig => {
  const base = normalizeBase(options.base ?? process.env.DOCS_BASE);
  const origin = (options.origin ?? process.env.DOCS_ORIGIN ?? defaultOrigin)
    .trim()
    .replace(/\/+$/, '');
  const siteUrl = new URL(base, `${origin || defaultOrigin}/`).toString();
  const publicAsset = (assetPath: string) =>
    `${base}${assetPath.replace(/^\//, '')}`;
  const absoluteAsset = (assetPath: string) =>
    new URL(assetPath.replace(/^\//, ''), siteUrl).toString();
  const builderConfig = config.builderConfig ?? {};
  const server = builderConfig.server ?? {};
  const themeConfig = config.themeConfig ?? {};
  const documentStatic = config.root
    ? { name: path.resolve(config.root, '..', 'static') }
    : undefined;
  const presetAssets = { name: fileURLToPath(ultraModernDocsAssets) };
  const publicDirectories = [
    ...asPublicDirectories(server.publicDir),
    ...(documentStatic ? [documentStatic] : []),
    presetAssets,
  ].filter(
    (candidate, index, all) =>
      all.findIndex(entry => entry.name === candidate.name) === index,
  );

  return {
    ...config,
    title: siteTitle,
    description: siteDescription,
    base,
    logo: {
      light: publicAsset('/img/ultramodern-logo-light.svg'),
      dark: publicAsset('/img/ultramodern-logo-dark.svg'),
    },
    icon: absoluteAsset('/img/favicon.ico'),
    themeConfig: {
      ...themeConfig,
      locales: (themeConfig.locales ?? []).map(locale => ({
        ...locale,
        title: siteTitle,
        description: socialDescription,
      })),
      editLink: {
        docRepoBaseUrl: `${githubUrl}/tree/main-ultramodern/packages/document/docs`,
        text: 'Edit this page on GitHub',
      },
      socialLinks: [
        ...(themeConfig.socialLinks ?? []).filter(
          link => link.icon !== 'github',
        ),
        { icon: 'github', mode: 'link', content: githubUrl },
      ],
    },
    builderConfig: {
      ...builderConfig,
      server: {
        ...server,
        publicDir: publicDirectories,
      },
      plugins: [
        ...(builderConfig.plugins ?? []).filter(
          plugin => plugin.name !== 'rsbuild-plugin-open-graph',
        ),
        pluginOpenGraph({
          title: siteTitle,
          siteName: siteTitle,
          type: 'website',
          url: siteUrl,
          image: absoluteAsset('/img/ultramodern-social-card.png'),
          description: socialDescription,
          twitter: {
            card: 'summary_large_image',
            title: siteTitle,
            image: absoluteAsset('/img/ultramodern-social-card.png'),
            description: socialDescription,
          },
        }),
      ],
    },
  };
};

export const defineUltraModernConfig = (config: UserConfig): UserConfig =>
  defineConfig(applyUltraModernDocsPreset(config));
