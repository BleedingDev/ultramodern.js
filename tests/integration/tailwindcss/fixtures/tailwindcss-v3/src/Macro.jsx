import React from 'react';
import tw from 'twin.macro';

const ConfigTest = () => {
  const DirectColorDiv = tw.div`w-[200px] h-[50px] bg-yellow-300`;

  return <DirectColorDiv data-testid="tailwind-v3-macro">tw</DirectColorDiv>;
};

export default ConfigTest;
