import {
  Link,
  useMatch,
  useNavigate,
} from '@modern-js/plugin-tanstack/runtime';
import * as React from 'react';

export function TanstackLocalisedRouterTypeTests() {
  const navigate = useNavigate();
  const productMatch = useMatch({ from: '/$lang/products/$slug' });
  const localisedProductMatch = useMatch({ from: '/$lang/produkty/$slug' });
  const optionalMatch = useMatch({ from: '/$lang/volitelne/{-$slug}' });

  const productSlug: string = productMatch.params.slug;
  const localisedProductSlug: string = localisedProductMatch.params.slug;
  const optionalSlug: string | undefined = optionalMatch.params.slug;

  const englishProduct = (
    <Link to="/$lang/products/$slug" params={{ lang: 'en', slug: 'shoe' }} />
  );
  const czechProduct = (
    <Link to="/$lang/produkty/$slug" params={{ lang: 'cs', slug: 'bota' }} />
  );
  const englishTerms = (
    <Link to="/$lang/terms-of-service" params={{ lang: 'en' }} />
  );
  const czechTerms = (
    <Link to="/$lang/obchodni-podminky" params={{ lang: 'cs' }} />
  );
  const optionalWithoutSlug = (
    <Link to="/$lang/volitelne/{-$slug}" params={{ lang: 'cs' }} />
  );
  const optionalWithSlug = (
    <Link
      to="/$lang/optional/{-$slug}"
      params={{ lang: 'en', slug: 'light' }}
    />
  );

  React.useEffect(() => {
    navigate({
      to: '/$lang/produkty/$slug',
      params: { lang: 'cs', slug: localisedProductSlug },
    });
    navigate({
      to: '/$lang/products/$slug',
      params: { lang: 'en', slug: productSlug },
    });
    navigate({
      to: '/$lang/volitelne/{-$slug}',
      params: { lang: 'cs', slug: optionalSlug },
    });
  }, [localisedProductSlug, navigate, optionalSlug, productSlug]);

  return (
    <>
      {englishProduct}
      {czechProduct}
      {englishTerms}
      {czechTerms}
      {optionalWithoutSlug}
      {optionalWithSlug}
    </>
  );
}
