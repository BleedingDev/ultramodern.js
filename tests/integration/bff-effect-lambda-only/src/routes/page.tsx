// @effect-diagnostics globalFetch:off
import { useEffect, useState } from 'react';

export default function Page() {
  const [message, setMessage] = useState('pending');

  useEffect(() => {
    fetch('/bff-api/effect/hello')
      .then(res => res.json())
      .then(data => {
        setMessage(data.message);
      });
  }, []);

  return <div className="effect-message">{message}</div>;
}
