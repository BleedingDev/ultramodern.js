import type { DataHandlerInput } from '@modern-js/renderer-core/data';

export function loader({ params }: DataHandlerInput) {
  return { item: `Item ${params.id}` };
}
