// Original implementation: bounded unsigned conversions, no native memory access.
function toBigIntBE(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new TypeError('Expected bytes');
  if (bytes.length > 1024) throw new RangeError('Maximum width is 1024 bytes');
  const hex = Buffer.from(bytes).toString('hex');
  return hex ? BigInt('0x' + hex) : 0n;
}
function toBigIntLE(bytes) { return toBigIntBE(Buffer.from(bytes).reverse()); }
function toBufferBE(value, width) {
  if (typeof value !== 'bigint' || value < 0n || !Number.isInteger(width) || width < 0 || width > 1024) throw new RangeError('Invalid unsigned integer or width');
  if (value >= (1n << BigInt(width * 8))) throw new RangeError('Integer exceeds width');
  return width ? Buffer.from(value.toString(16).padStart(width * 2, '0'), 'hex') : Buffer.alloc(0);
}
function toBufferLE(value, width) { return toBufferBE(value, width).reverse(); }
module.exports = {toBigIntBE, toBigIntLE, toBufferBE, toBufferLE};
