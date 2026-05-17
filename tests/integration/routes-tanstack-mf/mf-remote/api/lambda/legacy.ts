// @effect-diagnostics asyncFunction:off
export default async function legacyHello() {
  return {
    message: 'Hello from remote lambda in effect mode',
  };
}
