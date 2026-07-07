import { DEFAULT_API_PREFIX } from '@modern-js/utils';

export const normalizePrefixList = (prefix: string | string[] | undefined) => {
  if (Array.isArray(prefix)) {
    return prefix.filter(Boolean);
  }
  return [prefix || DEFAULT_API_PREFIX];
};

export const getPrimaryPrefix = (prefix: string | string[] | undefined) =>
  normalizePrefixList(prefix)[0] || DEFAULT_API_PREFIX;
