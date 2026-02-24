import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

const App = () => {
  const { changeLanguage, i18nInstance } = useModernI18n();
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
      <div id="key">{i18nInstance.t('key')}</div>
    </>
  );
};

export default App;
