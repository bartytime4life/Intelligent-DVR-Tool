// Exact orientation of finite IEEE-754 binary64 coordinates. This classifies
// the entered numbers, not measurement uncertainty or an unrounded projection.
const bits = new DataView(new ArrayBuffer(8));
const FRACTION = (1n << 52n) - 1n;
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const finitePoint = point => Array.isArray(point) && point.length === 2 &&
  finite(point[0]) && finite(point[1]);

function dyadic(value) {
  bits.setFloat64(0, value);
  const word = bits.getBigUint64(0), exponent = Number((word >> 52n) & 2047n);
  let mantissa = word & FRACTION;
  if (exponent) mantissa |= 1n << 52n;
  if (word >> 63n) mantissa = -mantissa;
  return [mantissa, exponent ? exponent - 1075 : -1074];
}

// Returns -1, 0 or 1; null for an invalid point (including sparse arrays).
// Common-power-of-two integers avoid overflow, underflow and cancellation.
// Binary64's bounded exponents bound each integer to at most 2098 bits.
export function orientationSign(origin, a, b) {
  if (!finitePoint(origin) || !finitePoint(a) || !finitePoint(b)) return null;
  const values = [...origin, ...a, ...b].map(dyadic);
  const exponents = values.filter(([mantissa]) => mantissa !== 0n).map(([, exponent]) => exponent);
  if (!exponents.length) return 0;
  const base = Math.min(...exponents);
  const [ox, oy, ax, ay, bx, by] = values.map(([mantissa, exponent]) =>
    mantissa === 0n ? 0n : mantissa << BigInt(exponent - base));
  const determinant = (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
  return determinant < 0n ? -1 : determinant > 0n ? 1 : 0;
}
