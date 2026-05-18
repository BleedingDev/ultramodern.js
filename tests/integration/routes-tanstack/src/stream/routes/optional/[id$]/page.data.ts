export const loader = ({
  params,
}: {
  params: Record<string, string | undefined>;
}) => ({
  id: params.id ?? 'none',
});
