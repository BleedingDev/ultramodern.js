// @effect-diagnostics asyncFunction:off
export default async () => {
  const managedError = new Error('Managed lambda error') as Error & {
    status?: number;
  };
  managedError.status = 500;
  throw managedError;
};
