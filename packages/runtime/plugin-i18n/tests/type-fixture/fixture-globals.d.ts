// The Window._SSR_DATA augmentation lives in @modern-js/runtime's internal
// core/types module, which this fixture's isolated program never pulls in.
interface Window {
  _SSR_DATA?: {
    data?: {
      i18nData?: {
        lng?: string;
      };
    };
  };
}
