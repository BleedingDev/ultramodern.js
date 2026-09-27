export default async () => {
  const data = new Promise((_resolve, reject) => {
    setTimeout(() => {
      reject(new Error('error occurs'));
    }, 200);
  });

  return data;
};
