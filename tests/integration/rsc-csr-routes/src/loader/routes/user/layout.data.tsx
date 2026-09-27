function Profile() {
  return <div>Profile Component</div>;
}

export const loader = async () => {
  const user = new Promise(resolve =>
    setTimeout(() => resolve('John Doe'), 500),
  );

  return { user, Profile: <Profile /> };
};
