document.body.textContent = JSON.stringify({
  type: typeof process.env.MODERN_MF_APP_SSR,
  value: process.env.MODERN_MF_APP_SSR,
});
