declare module '@api/effect/index' {
  const hostEffectBff: {
    client: {
      greetings: {
        hello: (_input: {}) => Promise<{ message: string }>;
      };
    };
  };

  export default hostEffectBff;
}

declare module '*.css';
