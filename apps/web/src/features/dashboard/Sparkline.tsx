// A small trend line: the values are only drawn, never shown, so plain numbers are fine here — every
// figure a person reads still comes from the exact decimal strings elsewhere on the card.
export function Sparkline({ values }: { readonly values: readonly number[] }): React.JSX.Element | null {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i: number): number => (i / (values.length - 1)) * 100;
  const y = (v: number): number => 26 - ((v - min) / span) * 24;
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  return (
    <svg className="mk-spark" viewBox="0 0 100 28" preserveAspectRatio="none" direction="ltr" aria-hidden="true">
      <path className="mk-spark__area" d={`${line} L100,28 L0,28 Z`} />
      <path className="mk-spark__line" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
