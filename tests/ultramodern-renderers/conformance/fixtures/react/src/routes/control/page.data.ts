import {
  observeControl,
  releaseControl,
} from '../../server/conformance-controls';

export function loader({ request }: { request: Request }): Response {
  return observeControl(request);
}

export function action({ request }: { request: Request }): Response {
  return releaseControl(request);
}
