export const loader = () => {
  throw new Response('Gone from the worker', { status: 410 });
};
