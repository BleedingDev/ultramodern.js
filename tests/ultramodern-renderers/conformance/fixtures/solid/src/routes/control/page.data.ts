import type { DataHandlerInput } from '@bleedingdev/modern-js-renderer-core/data';
import {
  observeControl,
  releaseControl,
} from '../../server/conformance-controls';

export function loader({ request }: DataHandlerInput): Response {
  return observeControl(request);
}

export function action({ request }: DataHandlerInput): Response {
  return releaseControl(request);
}
