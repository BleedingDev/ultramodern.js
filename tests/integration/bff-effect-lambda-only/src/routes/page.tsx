import lambdaHello from '@api/lambda';
import { useEffect, useState } from 'react';

export default function Page() {
  const [message, setMessage] = useState('pending');

  useEffect(() => {
    lambdaHello().then(data => {
      setMessage(data.message);
    });
  }, []);

  return <div className="lambda-message">{message}</div>;
}
