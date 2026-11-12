import BigNumber from 'bignumber.js';
import * as clipping from 'polyclip-ts';

// Decimal intersection division needs more than the default 20 places when
// projected wall faces share almost-collinear edges. Calls are synchronous;
// restore the caller's BigNumber configuration even if clipping throws.
// Inputs are not snapped to a grid or rounded by this adapter.
// It remains finite-precision arithmetic, not exact rational construction.
export const POLYGON_DECIMAL_PLACES = 80;
function operate(method,args) {
  const previous=BigNumber.config();
  try {
    BigNumber.config({DECIMAL_PLACES:POLYGON_DECIMAL_PLACES,ROUNDING_MODE:BigNumber.ROUND_HALF_UP});
    return clipping[method](...args);
  } finally { BigNumber.config(previous); }
}
export const union=(...args)=>operate('union',args);
export const intersection=(...args)=>operate('intersection',args);
export const difference=(...args)=>operate('difference',args);
export const xor=(...args)=>operate('xor',args);
