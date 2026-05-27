import { I18nLink } from '@modern-js/plugin-i18n/runtime';

export default function LinkProbePage() {
  return (
    <div id="link-probe">
      <I18nLink to="/terms-of-service" data-testid="i18n-terms">
        terms
      </I18nLink>
    </div>
  );
}
