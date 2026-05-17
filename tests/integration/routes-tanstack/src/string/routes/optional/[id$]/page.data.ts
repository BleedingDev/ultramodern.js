// @effect-diagnostics unnecessaryArrowBlock:off
export const loader = ({
  params,
}: {
  params: Record<string, string | undefined>;
}) => {
  return {
    id: params.id ?? 'none',
  };
};
