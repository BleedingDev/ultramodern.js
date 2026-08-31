export const handleRSCRedirect = (
  headers: Headers,
  basename: string,
  status: number,
): Response => {
  const newHeaders = new Headers(headers);
  let redirectUrl = headers.get('Location');

  if (
    !redirectUrl ||
    ![301, 302, 303, 307, 308].includes(status) ||
    !URL.canParse(redirectUrl, 'http://localhost')
  ) {
    return new Response(null, { status, headers: newHeaders });
  }

  if (basename !== '/' && redirectUrl.startsWith(basename)) {
    redirectUrl = redirectUrl.slice(basename.length) || '/';
  }

  newHeaders.set('X-Modernjs-Redirect', redirectUrl);
  newHeaders.set('X-Modernjs-BaseUrl', basename);
  newHeaders.delete('Location');

  return new Response(null, {
    status,
    headers: newHeaders,
  });
};
