export const loader = () =>
  new Response(null, { status: 302, headers: { Location: '/user/7' } });
