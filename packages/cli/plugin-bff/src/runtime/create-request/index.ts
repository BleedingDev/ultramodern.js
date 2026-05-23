/* @modern-js/create-request will auto select server or client implementation */
import {
  configure,
  createRequest,
  createRequestContextHeaders,
  createRequestContextSnapshot,
  createUploader,
} from '@modern-js/create-request';

export type {
  OperationContext,
  OperationContextSource,
  RequestContextInput,
  RequestContextSnapshot,
} from '@modern-js/create-request';
export {
  configure,
  createRequest,
  createRequestContextHeaders,
  createRequestContextSnapshot,
  createUploader,
};
