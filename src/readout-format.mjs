// Display only: never quantize the stored value or a calculation's inputs.
export function formatReadoutNumber(value, {digits=1, minimumDigits=0, locale}={}) {
  if (!Number.isFinite(value) || !Number.isInteger(digits) || digits<0 || digits>12 ||
      !Number.isInteger(minimumDigits) || minimumDigits<0 || minimumDigits>digits) return '—';
  // A signed IEEE zero is still exactly zero; genuine small negative values
  // retain their sign instead of becoming an indistinguishable negative zero.
  if (value===0) value=0;
  for (let precision=digits;precision<=12;precision++) {
    const formatter=new Intl.NumberFormat(locale,{maximumFractionDigits:precision,minimumFractionDigits:minimumDigits});
    const rendered=formatter.format(value);
    if (value===0 || (rendered!==formatter.format(0) && rendered!==formatter.format(-0))) return rendered;
  }
  // Keep work and label length bounded for arbitrarily small finite inputs.
  return value.toExponential(2);
}

// Only exact endpoint fractions may read as zero or complete coverage.
export function formatCoveragePercent(fraction) {
  if (!Number.isFinite(fraction) || fraction<0 || fraction>1) return '—';
  const rounded=Math.round(fraction*1000)/10;
  if (fraction>0 && rounded===0) return '<0.1%';
  if (fraction<1 && rounded===100) return '>99.9%';
  return `${rounded.toFixed(1)}%`;
}
