export type LocalisedRoute = {
  type: 'nested' | 'page';
  path?: string;
  id?: string;
  children?: LocalisedRoute[];
  [key: string]: any;
};

export type LocalisedUrlPathMap = Record<string, string>;

export type LocalisedUrlsMap = Record<string, LocalisedUrlPathMap>;

export type LocalisedUrlsOption = boolean | LocalisedUrlsMap;

export interface ResolvedLocalisedUrlsConfig {
  enabled: boolean;
  map: LocalisedUrlsMap;
}
