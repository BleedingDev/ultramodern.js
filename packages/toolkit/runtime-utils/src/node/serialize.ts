const SCRIPT_UNSAFE_CHARACTER = /[<>/\u2028\u2029]/gu;

const SCRIPT_UNSAFE_CHARACTER_ESCAPE: Readonly<Record<string, string>> = {
  '<': '\\u003C',
  '>': '\\u003E',
  '/': '\\u002F',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

export const serializeJson = (data: any) => {
  const serialized = JSON.stringify(data);

  if (typeof serialized !== 'string') {
    return String(serialized);
  }

  return serialized.replace(
    SCRIPT_UNSAFE_CHARACTER,
    character => SCRIPT_UNSAFE_CHARACTER_ESCAPE[character],
  );
};
