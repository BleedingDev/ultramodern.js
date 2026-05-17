// @effect-diagnostics asyncFunction:off unnecessaryArrowBlock:off
export default async () => {
  return {
    message: 'Hello from lambda-only effect runtime',
  };
};
