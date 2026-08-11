export const handleRSCRedirect = (
  headers: Headers,
  basename: string,
  status: number,
): Response => {
  const newHeaders = new Headers(headers);
  let redirectUrl = headers.get('Location')!;

  if (basename !== '/') {
    redirectUrl = redirectUrl.replace(basename, '');
  }

  newHeaders.set('X-Modernjs-Redirect', redirectUrl);
  newHeaders.set('X-Modernjs-BaseUrl', basename);
  newHeaders.delete('Location');

  return new Response(null, {
    status,
    headers: newHeaders,
  });
};
