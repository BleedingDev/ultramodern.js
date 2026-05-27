export type OptionalData = {
  language: string;
  slug: string;
};

export const loader = ({
  params,
}: {
  params: Record<string, string | undefined>;
}) => ({
  language: params.lang || 'en',
  slug: params.slug || 'none',
});
