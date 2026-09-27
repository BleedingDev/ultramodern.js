export const loader = async () => {
  const user = new Promise(resolve =>
    setTimeout(() => resolve('user page data'), 1000),
  );

  return { user };
};
