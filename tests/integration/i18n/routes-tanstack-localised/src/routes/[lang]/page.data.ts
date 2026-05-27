import i18next from '../../i18n';

export type HomeData = {
  language: string;
  message: string;
};

export const loader = ({ params }: { params: Record<string, string> }) => {
  const language = params.lang || 'en';

  return {
    language,
    message: i18next.t('home', { lng: language }),
  };
};
