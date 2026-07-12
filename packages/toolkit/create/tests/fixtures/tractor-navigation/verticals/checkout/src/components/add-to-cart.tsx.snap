import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useCartLines } from '../cart-store';

export interface CheckoutAddToCartProps {
  image?: string;
  price?: number;
  productName?: string;
  slug?: string;
  sku?: string;
}

export default function CheckoutAddToCart({
  image = 'https://blueprint.the-tractor.store/cdn/img/product/200/CL-08-GR.webp',
  price = 7750,
  productName = 'Holland Hamster Polder Green',
  slug = 'holland-hamster',
  sku = 'CL-08-GR',
}: CheckoutAddToCartProps) {
  const { language, t } = useModernI18n();
  const cart = useCartLines();

  return (
    <div
      className="checkout:mt-8 checkout:px-0 checkout:py-0"
      data-modern-boundary-id="checkout"
      data-modern-mf-expose="./AddToCart"
    >
      <div className="checkout:flex checkout:items-start checkout:justify-between checkout:gap-6 checkout:text-[1rem]">
        <span>{price.toLocaleString('de-DE', { useGrouping: false })} Ø</span>
        <span className="checkout:text-right checkout:text-[#45aa4f]">
          {t('checkout.product.stockShipping')}
        </span>
      </div>
      <a
        className="checkout:mt-8 checkout:flex checkout:min-h-12 checkout:w-full checkout:items-center checkout:justify-center checkout:rounded-full checkout:bg-stone-800 checkout:px-5 checkout:text-[0.9rem] checkout:font-bold checkout:uppercase checkout:tracking-[0.42em] checkout:text-white checkout:no-underline checkout:shadow-[0_0_14px_rgba(0,0,0,0.18)] checkout:focus-visible:outline checkout:focus-visible:outline-2 checkout:focus-visible:outline-offset-4 checkout:focus-visible:outline-[#f6cf45]"
        href={`/${language}/cart?sku=${sku}`}
        onClick={() => cart.addProduct({ id: sku, image, name: productName, price, slug })}
      >
        {t('checkout.actions.addToCart')}
      </a>
    </div>
  );
}
