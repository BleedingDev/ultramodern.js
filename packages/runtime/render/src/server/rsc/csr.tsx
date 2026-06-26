import { createRenderCSRWithRSC } from './csr.shared';
import { renderRsc } from './rsc';

export const renderCSRWithRSC = createRenderCSRWithRSC(renderRsc);
