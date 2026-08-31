export function arrayBufferToHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
}

export function inspectBuffer(buf: ArrayBuffer | Uint8Array, length = 16) {
  const bytes =
    buf instanceof Uint8Array ? buf : new Uint8Array(buf, 0, buf.byteLength);
  const visible = bytes.slice(0, length);
  const hex = arrayBufferToHex(visible.buffer);
  return `${hex} +${buf.byteLength - length} bytes`;
}
