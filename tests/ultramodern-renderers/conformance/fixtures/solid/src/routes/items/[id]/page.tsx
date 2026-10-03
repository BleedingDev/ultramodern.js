import { useRouter } from '@bleedingdev/modern-js-renderer-solid/router';
import { useHead } from '@solidjs/web';
import Home from '../../page';

export default function Item() {
  const router = useRouter();
  useHead({
    tag: 'base',
    props: {
      href: `${(router.options.basepath ?? '').replace(/\/$/u, '')}/items/`,
    },
  });
  return <Home />;
}
