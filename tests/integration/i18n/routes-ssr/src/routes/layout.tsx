import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { Outlet, useFetcher } from '@modern-js/runtime/router';
import { useEffect } from 'react';

export default function Layout() {
  const { changeLanguage } = useModernI18n();
  const fetcher = useFetcher();
  // Tests wait for html[data-hydrated] before interacting with the page.
  useEffect(() => {
    document.documentElement.dataset.hydrated = '';
  }, []);
  const handleChangeLanguage = (language: string) => {
    changeLanguage(language);
    // 使用 data action 来更新 loader 数据
    // action 路径指向新语言路由的 page.data.ts
    // 这样 action 执行完后，新路由的 loader 会自动重新执行
    fetcher.submit(
      { language },
      {
        method: 'POST',
        action: `/${language}`,
        encType: 'application/json',
      },
    );
  };
  return (
    <div>
      <div>
        <button id="zh-button" onClick={() => handleChangeLanguage('zh')}>
          zh
        </button>
        <button id="en-button" onClick={() => handleChangeLanguage('en')}>
          en
        </button>
      </div>
      <Outlet />
    </div>
  );
}
