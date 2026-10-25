/**
 * Instagram-style counts: 0 shows nothing, up to 9,999 shows the whole number
 * (1,234), then 10.3K, 30.3K, 1.2M ... Never rounds up into the next unit.
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  const whole = Math.floor(n);
  if (whole < 10_000) return whole.toLocaleString("en-US");
  const units: [number, string][] = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ];
  for (const [size, suffix] of units) {
    if (whole >= size) {
      const value = Math.floor((whole / size) * 10) / 10;
      return `${value.toFixed(1).replace(/\.0$/, "")}${suffix}`;
    }
  }
  return String(whole);
}
