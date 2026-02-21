import { useParams } from '@modern-js/runtime/router';
import React from 'react';
import RemoteAppUnavailable from '../../../components/RemoteAppUnavailable';

export default (props: Record<string, any>) => {
  const { lang } = useParams();
  return (
    <div>
      <h2>远程应用不可用页面</h2>
      <RemoteAppUnavailable
        {...props}
        basename={`${lang}/remote-unavailable`}
        customProp="hello from host"
      />
    </div>
  );
};
