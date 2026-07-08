import { fs } from '@modern-js/utils';
import type { Middleware } from '../../../types';

type SupportedEncoding = 'br' | 'gzip';

type ResolvePreCompressedAssetResult = {
  selected: {
    filepath: string;
    encoding: SupportedEncoding;
  } | null;
  hasVariant: boolean;
};

const PRE_COMPRESSED_ASSET_EXTENSIONS: Record<SupportedEncoding, string> = {
  br: '.br',
  gzip: '.gz',
};

const PRE_COMPRESSED_SUPPORTED_ENCODINGS: SupportedEncoding[] = ['br', 'gzip'];

const parseAcceptEncoding = (value: string) =>
  value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [rawName, ...params] = item.split(';');
      const name = rawName.trim().toLowerCase();
      let q = 1;

      for (const param of params) {
        const [key, rawValue] = param.split('=').map(v => v.trim());
        if (key.toLowerCase() !== 'q' || rawValue == null) {
          continue;
        }

        const parsedQ = Number(rawValue);
        if (!Number.isNaN(parsedQ)) {
          q = Math.max(0, Math.min(parsedQ, 1));
        }
      }

      return {
        name,
        q,
      };
    });

const getAcceptedEncodings = (
  value: string | null | undefined,
): SupportedEncoding[] => {
  if (!value) {
    return [];
  }

  const parsed = parseAcceptEncoding(value);
  const qualityByEncoding = new Map<string, number>();
  let wildcardQuality: number | undefined;

  for (const { name, q } of parsed) {
    if (name === '*') {
      wildcardQuality = q;
      continue;
    }
    qualityByEncoding.set(name, q);
  }

  const getQuality = (encoding: SupportedEncoding) => {
    const explicit = qualityByEncoding.get(encoding);
    if (explicit !== undefined) {
      return explicit;
    }
    return wildcardQuality ?? 0;
  };

  return PRE_COMPRESSED_SUPPORTED_ENCODINGS.map(encoding => ({
    encoding,
    quality: getQuality(encoding),
  }))
    .filter(item => item.quality > 0)
    .sort((a, b) => b.quality - a.quality)
    .map(item => item.encoding);
};

const appendVaryHeader = (
  c: Parameters<Middleware>[0],
  value: string,
): void => {
  const current = c.res.headers.get('Vary');

  if (!current) {
    c.header('Vary', value);
    return;
  }

  const values = current
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);

  if (!values.includes(value.toLowerCase())) {
    c.header('Vary', `${current}, ${value}`);
  }
};

export const resolvePreCompressedAsset = async (
  c: Parameters<Middleware>[0],
  filepath: string,
): Promise<ResolvePreCompressedAssetResult> => {
  const brPath = `${filepath}${PRE_COMPRESSED_ASSET_EXTENSIONS.br}`;
  const gzipPath = `${filepath}${PRE_COMPRESSED_ASSET_EXTENSIONS.gzip}`;

  const [hasBr, hasGzip] = await Promise.all([
    fs.pathExists(brPath),
    fs.pathExists(gzipPath),
  ]);

  const hasVariant = hasBr || hasGzip;
  if (!hasVariant) {
    return {
      selected: null,
      hasVariant: false,
    };
  }

  const acceptedEncodings = getAcceptedEncodings(
    c.req.header('accept-encoding'),
  );

  for (const encoding of acceptedEncodings) {
    if (encoding === 'br' && hasBr) {
      return {
        selected: {
          filepath: brPath,
          encoding,
        },
        hasVariant: true,
      };
    }

    if (encoding === 'gzip' && hasGzip) {
      return {
        selected: {
          filepath: gzipPath,
          encoding,
        },
        hasVariant: true,
      };
    }
  }

  return {
    selected: null,
    hasVariant: true,
  };
};

export const applyPreCompressedAssetHeaders = (
  c: Parameters<Middleware>[0],
  preCompressedAsset: ResolvePreCompressedAssetResult,
) => {
  if (preCompressedAsset.hasVariant) {
    appendVaryHeader(c, 'Accept-Encoding');
  }

  if (preCompressedAsset.selected) {
    c.header('Content-Encoding', preCompressedAsset.selected.encoding);
  }
};
