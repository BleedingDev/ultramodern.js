export type UltramodernPublicSitemapChangeFrequency =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

export type UltramodernPublicSitemapEntry = {
  /**
   * Params used to expand every localized route pattern, for example
   * { slug: 'platform-story' } for /talks/:slug.
   */
  params: Record<string, string | number | boolean>;
  /**
   * Per-locale overrides when translated URLs use translated params.
   */
  localeParams?: Partial<Record<'en' | 'cs', Record<string, string | number | boolean>>>;
  draft?: boolean;
  indexable?: boolean;
  lastModified?: string;
  changeFrequency?: UltramodernPublicSitemapChangeFrequency;
  priority?: number;
};

export const ultramodernWorkspaceContract = {
  ownership: 'topology/ownership.json',
  preset: 'presetUltramodern',
  topology: 'topology/reference-topology.json',
} as const;
