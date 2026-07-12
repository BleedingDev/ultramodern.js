import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import type { FormEvent } from 'react';
import { useCartLines } from '../cart-store';

const formatPrice = (price: number) => `${price.toLocaleString('de-DE', { useGrouping: false })} Ø`;

export default function CheckoutCheckoutPage() {
  const { language, t } = useModernI18n();
  const cart = useCartLines();

  const submitOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const order = cart.placeOrder();
    if (order === undefined) {
      return;
    }
    window.location.assign(`/${language}/checkout/thank-you/${order.id}`);
  };

  return (
    <main
      className="checkout:mx-auto checkout:grid checkout:max-w-[calc(1000px+var(--outer-space)*2)] checkout:gap-8 checkout:px-[var(--outer-space)] checkout:py-4 checkout:min-[900px]:grid-cols-[1.1fr_0.9fr]"
      data-modern-boundary-id="checkout"
      data-modern-mf-expose="./CheckoutPage"
    >
      <section>
        <h1 className="checkout:m-0 checkout:text-[1.7rem] checkout:font-normal checkout:text-stone-950">
          {t('checkout.routes.checkout')}
        </h1>
        {cart.lines.length > 0 ? (
          <form className="checkout:mt-8 checkout:grid checkout:gap-5" onSubmit={submitOrder}>
            <label className="checkout:grid checkout:gap-2 checkout:text-sm checkout:font-bold checkout:text-stone-900">
              {t('checkout.form.name')}
              <input
                aria-label={t('checkout.form.name')}
                autoComplete="name"
                className="checkout:min-h-12 checkout:border checkout:border-stone-300 checkout:bg-white checkout:px-4 checkout:text-base checkout:font-normal"
                name="name"
                required
              />
            </label>
            <label className="checkout:grid checkout:gap-2 checkout:text-sm checkout:font-bold checkout:text-stone-900">
              {t('checkout.form.email')}
              <input
                aria-label={t('checkout.form.email')}
                autoComplete="email"
                className="checkout:min-h-12 checkout:border checkout:border-stone-300 checkout:bg-white checkout:px-4 checkout:text-base checkout:font-normal"
                name="email"
                required
                type="email"
              />
            </label>
            <label className="checkout:grid checkout:gap-2 checkout:text-sm checkout:font-bold checkout:text-stone-900">
              {t('checkout.form.address')}
              <textarea
                aria-label={t('checkout.form.address')}
                autoComplete="street-address"
                className="checkout:min-h-24 checkout:border checkout:border-stone-300 checkout:bg-white checkout:px-4 checkout:py-3 checkout:text-base checkout:font-normal"
                name="address"
                required
              />
            </label>
            <button
              className="checkout:inline-flex checkout:min-h-12 checkout:items-center checkout:justify-center checkout:rounded-full checkout:bg-stone-800 checkout:px-9 checkout:text-[0.9rem] checkout:font-bold checkout:uppercase checkout:tracking-[0.42em] checkout:text-white checkout:shadow-[0_0_14px_rgba(0,0,0,0.18)]"
              type="submit"
            >
              {t('checkout.actions.placeOrder')}
            </button>
          </form>
        ) : (
          <div className="checkout:mt-8 checkout:rounded-lg checkout:border checkout:border-stone-200 checkout:bg-white checkout:p-6">
            <p className="checkout:m-0 checkout:text-stone-700">{t('checkout.cart.empty')}</p>
            <a
              className="checkout:mt-6 checkout:inline-flex checkout:min-h-12 checkout:items-center checkout:justify-center checkout:rounded-full checkout:border checkout:border-stone-300 checkout:bg-white checkout:px-9 checkout:text-[0.9rem] checkout:font-bold checkout:uppercase checkout:tracking-[0.42em] checkout:text-stone-900 checkout:no-underline checkout:shadow-[0_0_14px_rgba(0,0,0,0.08)]"
              href={`/${language}/tractors`}
            >
              {t('checkout.actions.continueShopping')}
            </a>
          </div>
        )}
      </section>
      <aside className="checkout:rounded-lg checkout:border checkout:border-stone-200 checkout:bg-white checkout:p-6 checkout:shadow-[0_10px_30px_rgba(28,25,23,0.08)]">
        <h2 className="checkout:m-0 checkout:text-xl checkout:font-bold checkout:text-stone-950">
          {t('checkout.summary.title')}
        </h2>
        <ul className="checkout:mt-5 checkout:list-none checkout:p-0">
          {cart.lines.map((line) => (
            <li
              className="checkout:flex checkout:items-center checkout:gap-4 checkout:border-b checkout:border-stone-200 checkout:py-4"
              key={line.id}
            >
              <img
                alt=""
                className="checkout:aspect-square checkout:w-16 checkout:object-contain"
                height="64"
                src={line.image}
                width="64"
              />
              <div className="checkout:min-w-0 checkout:flex-1">
                <strong className="checkout:block checkout:font-normal">{line.name}</strong>
                <span className="checkout:block checkout:text-sm checkout:text-stone-600">
                  {line.id} × {line.quantity}
                </span>
              </div>
              <span>{formatPrice(line.price * line.quantity)}</span>
            </li>
          ))}
        </ul>
        <p className="checkout:mt-5 checkout:text-right checkout:text-[1rem] checkout:font-bold">
          {t('checkout.cart.total')}: {formatPrice(cart.total)}
        </p>
      </aside>
    </main>
  );
}
