export function loader({ params }: { params: Record<string, string> }) {
  return { item: `Item ${params.id}` };
}
