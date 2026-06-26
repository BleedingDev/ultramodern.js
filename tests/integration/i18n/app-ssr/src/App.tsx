import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

const App = () => {
  const { changeLanguage, t } = useModernI18n();
  return (
    <>
      <div>
        <button id="zh-button" onClick={() => changeLanguage('zh')}>
          zh
        </button>
        <button id="en-button" onClick={() => changeLanguage('en')}>
          en
        </button>
      </div>
      <div id="key">{t('key')}</div>
    </>
  );
};

export default App;
