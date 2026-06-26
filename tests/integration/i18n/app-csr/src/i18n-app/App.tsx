import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { BrowserRouter, Route, Routes } from '@modern-js/runtime/router';

const App = () => {
  const { changeLanguage, t } = useModernI18n();

  return (
    <BrowserRouter>
      <div>
        <button id="zh-button" onClick={() => changeLanguage('zh')}>
          zh
        </button>
        <button id="en-button" onClick={() => changeLanguage('en')}>
          en
        </button>
      </div>
      <Routes>
        <Route index element={<div id="key">{t('key')}</div>} />
        <Route path="about" element={<div id="about">{t('about')}</div>} />
        <Route path="*">404</Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
