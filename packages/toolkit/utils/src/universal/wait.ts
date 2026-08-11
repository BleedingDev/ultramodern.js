export const wait = (milliseconds = 0) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, milliseconds);
  });
