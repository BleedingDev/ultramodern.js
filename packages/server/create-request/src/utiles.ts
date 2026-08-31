import type { BFFRequestPayload } from './types';

export const getUploadPayload = (args: any) => {
  const payload: BFFRequestPayload =
    typeof args[args.length - 1] === 'object' ? args[args.length - 1] : {};

  const files = payload.files;
  if (!files) {
    throw new Error('no files');
  }

  const formdata = new FormData();
  for (const [key, value] of Object.entries(files)) {
    if (typeof FileList !== 'undefined' && value instanceof FileList) {
      for (let i = 0; i < value.length; i++) {
        const file = value.item(i);
        if (file) {
          formdata.append(key, file);
        }
      }
    } else {
      formdata.append(key, value);
    }
  }

  const body: any = formdata;

  return { body, headers: payload.headers, params: payload.params };
};
