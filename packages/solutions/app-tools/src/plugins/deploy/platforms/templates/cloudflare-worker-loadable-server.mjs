import loadableComponent from '@loadable/component';
import React from 'react';

const internals =
  loadableComponent?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED || {};
const LoadableContext = internals.Context || React.createContext(null);
const getRequiredChunkKey =
  internals.getRequiredChunkKey ||
  (namespace => `${namespace}__LOADABLE_REQUIRED_CHUNKS__`);

const scriptExtensions = new Set(['.js', '.mjs']);
const styleExtensions = new Set(['.css']);

function uniqByUrl(assets) {
  const seen = new Set();

  return assets.filter(asset => {
    if (seen.has(asset.url)) {
      return false;
    }

    seen.add(asset.url);
    return true;
  });
}

function extname(filePath) {
  const basename = String(filePath).split('/').pop() || '';
  const index = basename.lastIndexOf('.');

  return index > 0 ? basename.slice(index) : '';
}

function isAutomaticPublicPath(publicPath) {
  return publicPath === 'auto' || publicPath === 'auto/';
}

function joinUrl(publicPath, filename) {
  const base =
    !publicPath || isAutomaticPublicPath(publicPath) ? '/' : publicPath;

  return `${base.replace(/\/+$/u, '')}/${String(filename).replace(/^\/+/u, '')}`;
}

function extraPropsToString(extraProps = {}) {
  return Object.entries(extraProps)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([key, value]) => (value === true ? ` ${key}` : ` ${key}="${value}"`))
    .join('');
}

function assetScriptType(filename) {
  const extension = extname(filename);

  if (scriptExtensions.has(extension)) {
    return 'script';
  }

  if (styleExtensions.has(extension)) {
    return 'style';
  }
}

function getAssetName(asset) {
  return typeof asset === 'object' && asset?.name ? asset.name : asset;
}

function getAssetIntegrity(asset) {
  return typeof asset === 'object' && asset?.integrity ? asset.integrity : null;
}

function getChunkGroupAssets(chunkGroup) {
  const assets = chunkGroup?.assets;

  if (Array.isArray(assets)) {
    return assets;
  }

  if (assets && typeof assets === 'object') {
    return [...(assets.js || []), ...(assets.css || [])];
  }

  return [];
}

function getChunkGroupChildAssets(chunkGroup, type) {
  const childAssets = chunkGroup?.childAssets?.[type];

  return Array.isArray(childAssets) ? childAssets : [];
}

function chunkIncludesJs(chunkInfo) {
  return (chunkInfo?.files || []).some(file =>
    scriptExtensions.has(extname(file)),
  );
}

export function ChunkExtractorManager({ extractor, children }) {
  return React.createElement(
    LoadableContext.Provider,
    { value: extractor },
    children,
  );
}

export class ChunkExtractor {
  constructor({
    stats,
    entrypoints = ['main'],
    namespace = '',
    outputPath = '/',
    publicPath,
  } = {}) {
    this.namespace = namespace;
    this.stats = stats || {};
    const configuredPublicPath = publicPath || this.stats.publicPath;
    this.publicPath =
      !configuredPublicPath || isAutomaticPublicPath(configuredPublicPath)
        ? '/'
        : configuredPublicPath;
    this.outputPath = outputPath || this.stats.outputPath || '/';
    this.entrypoints = Array.isArray(entrypoints) ? entrypoints : [entrypoints];
    this.chunks = [];
  }

  addChunk(chunk) {
    if (!this.chunks.includes(chunk)) {
      this.chunks.push(chunk);
    }
  }

  collectChunks(app) {
    return React.createElement(ChunkExtractorManager, { extractor: this }, app);
  }

  getChunkGroup(chunk) {
    return (
      this.stats.namedChunkGroups?.[chunk] || {
        assets: [],
        childAssets: {},
        chunks: [],
      }
    );
  }

  getChunkInfo(chunkId) {
    return (this.stats.chunks || []).find(chunk => chunk.id === chunkId);
  }

  resolvePublicUrl(filename) {
    return joinUrl(this.publicPath, filename);
  }

  createChunkAsset({ filename, chunk, type, linkType }) {
    const resolvedFilename = getAssetName(filename);
    const scriptType = assetScriptType(resolvedFilename);

    if (!scriptType) {
      return undefined;
    }

    return {
      filename: resolvedFilename,
      integrity: getAssetIntegrity(filename),
      scriptType,
      chunk,
      url: this.resolvePublicUrl(resolvedFilename),
      path: String(resolvedFilename).replace(/^\/+/u, ''),
      type,
      linkType,
    };
  }

  getChunkAssets(chunks) {
    const one = chunk =>
      getChunkGroupAssets(this.getChunkGroup(chunk))
        .map(filename =>
          this.createChunkAsset({
            filename,
            chunk,
            type: 'mainAsset',
            linkType: 'preload',
          }),
        )
        .filter(Boolean);

    return Array.isArray(chunks) ? uniqByUrl(chunks.flatMap(one)) : one(chunks);
  }

  getChunkChildAssets(chunks, type) {
    const one = chunk =>
      getChunkGroupChildAssets(this.getChunkGroup(chunk), type)
        .map(filename =>
          this.createChunkAsset({
            filename,
            chunk,
            type: 'childAsset',
            linkType: type,
          }),
        )
        .filter(Boolean);

    return Array.isArray(chunks) ? uniqByUrl(chunks.flatMap(one)) : one(chunks);
  }

  getChunkDependencies(chunks) {
    const one = chunk =>
      (this.getChunkGroup(chunk).chunks || []).filter(chunkId =>
        chunkIncludesJs(this.getChunkInfo(chunkId)),
      );

    return Array.isArray(chunks)
      ? [...new Set(chunks.flatMap(one))]
      : one(chunks);
  }

  getRequiredChunksScriptContent() {
    return JSON.stringify(this.getChunkDependencies(this.chunks));
  }

  getRequiredChunksNamesScriptContent() {
    return JSON.stringify({ namedChunks: this.chunks });
  }

  getRequiredChunksScriptTag(extraProps = {}) {
    const id = getRequiredChunkKey(this.namespace);
    const props = `type="application/json"${extraPropsToString(extraProps)}`;

    return [
      `<script id="${id}" ${props}>${this.getRequiredChunksScriptContent()}</script>`,
      `<script id="${id}_ext" ${props}>${this.getRequiredChunksNamesScriptContent()}</script>`,
    ].join('');
  }

  getMainAssets(scriptType) {
    const assets = this.getChunkAssets([...this.entrypoints, ...this.chunks]);

    return scriptType
      ? assets.filter(asset => asset.scriptType === scriptType)
      : assets;
  }

  getScriptTags(extraProps = {}) {
    const scripts = this.getMainAssets('script').map(
      asset =>
        `<script async data-chunk="${asset.chunk}" src="${asset.url}"${extraPropsToString(extraProps)}></script>`,
    );

    return [this.getRequiredChunksScriptTag(extraProps), ...scripts].join('');
  }

  getStyleTags(extraProps = {}) {
    return this.getMainAssets('style')
      .map(
        asset =>
          `<link data-chunk="${asset.chunk}" rel="stylesheet" href="${asset.url}"${extraPropsToString(extraProps)}>`,
      )
      .join('');
  }

  getLinkTags(extraProps = {}) {
    const assets = [
      ...this.getMainAssets(),
      ...this.getChunkChildAssets(
        [...this.entrypoints, ...this.chunks],
        'preload',
      ),
      ...this.getChunkChildAssets(
        [...this.entrypoints, ...this.chunks],
        'prefetch',
      ),
    ];

    return uniqByUrl(assets)
      .map(
        asset =>
          `<link data-chunk="${asset.chunk}" rel="${asset.linkType}" as="${asset.scriptType}" href="${asset.url}"${extraPropsToString(extraProps)}>`,
      )
      .join('');
  }
}
