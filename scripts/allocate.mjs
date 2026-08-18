/**
 * Pure allocation maths for the manual-share sliders.
 *
 * No DOM, no Foundry globals -- see test/allocate.test.mjs.
 *
 * Every function here is deterministic: the same inputs always produce the same
 * output. That property is what stops the sliders wandering. The UI must derive
 * each frame of a drag from the values captured when the drag STARTED, never from
 * the values it wrote during the previous frame, or rounding error accumulates and
 * the untouched sliders visibly drift.
 */

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/** Every threshold level, in the order a carrier crosses them. */
export const ALL_LEVELS = ["encumbered", "heavilyEncumbered", "maximum"];

/**
 * How much more weight the pile can absorb before some carrier crosses their next
 * encumbrance threshold, and who that carrier is.
 *
 * A carrier only absorbs their fraction of new loot, so the pile can grow by
 * `their headroom / their fraction` before they cross. The binding carrier is
 * whoever yields the smallest such figure -- not simply whoever is nearest a
 * threshold, since a carrier taking a small share approaches it slowly.
 *
 * "Next threshold" means the first one they have NOT already crossed. Someone
 * already heavily encumbered by their own gear is measured against `maximum`,
 * so their pre-existing state is not reported as an alarm.
 *
 * @param {Array<{name: string, carried: number, share: number,
 *                thresholds: {encumbered: number, heavilyEncumbered: number, maximum: number}}>} carriers
 * @param {number} total  Current pile weight.
 * @param {string[]} [levels=ALL_LEVELS]  Levels this world actually applies. Under
 *   the basic rule only `maximum` does anything, so reporting a carrier as nearing
 *   "heavily encumbered" would name a line with no mechanical effect.
 * @returns {{slack: number|null, limiting: Array<{name: string, threshold: string}>, over: boolean}}
 */
export function headroom(carriers, total, levels = ALL_LEVELS) {
  const over = [];
  const constrained = [];
  if ( !levels.length ) return { slack: null, limiting: [], over: false };

  const last = levels[levels.length - 1];

  for ( const c of carriers ) {
    // Thresholds shift down by whatever this carrier already shoulders.
    const level = levels.find(k => c.carried <= (c.thresholds[k] - c.share));
    if ( !level ) {
      over.push({ name: c.name, threshold: last });
      continue;
    }
    const room = (c.thresholds[level] - c.share) - c.carried;
    // A carrier taking no share never crosses as the pile grows.
    const fraction = total > 0 ? c.share / total : 0;
    if ( fraction <= 0 ) continue;
    constrained.push({ name: c.name, threshold: level, slack: room / fraction });
  }

  if ( over.length ) return { slack: null, limiting: over, over: true };
  if ( !constrained.length ) return { slack: null, limiting: [], over: false };

  const min = Math.min(...constrained.map(c => c.slack));
  return {
    slack: Math.round(min * 10) / 10,
    // Ties are reported in full rather than picking an arbitrary winner.
    limiting: constrained.filter(c => (c.slack - min) < 0.05).map(({ name, threshold }) => ({ name, threshold })),
    over: false
  };
}

/**
 * Round a set of fractional values to integers summing exactly to `target`,
 * using the largest-remainder method.
 *
 * Ties break on index so the result is stable rather than dependent on sort
 * implementation -- a wobbling tie-break is itself a source of visible jitter.
 *
 * @param {number[]} values  Fractional values, expected to sum to ~target.
 * @param {number} target    Exact integer total required.
 * @returns {number[]}
 */
export function apportionIntegers(values, target) {
  if ( !values.length ) return [];
  const floors = values.map(Math.floor);
  let remainder = target - floors.reduce((a, b) => a + b, 0);

  const byFraction = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

  const out = floors.slice();
  for ( let k = 0; (k < remainder) && (k < byFraction.length); k++ ) out[byFraction[k].i] += 1;

  // Guard the pathological case where remainder exceeds the number of entries.
  let drift = target - out.reduce((a, b) => a + b, 0);
  for ( let k = 0; drift > 0; k = (k + 1) % out.length ) { out[k] += 1; drift--; }

  return out;
}

/**
 * Scale a set of values so they total `target`, as integers.
 * @param {number[]} values
 * @param {number} [target=100]
 * @returns {number[]}
 */
export function normalize(values, target = 100) {
  if ( !values.length ) return [];
  const sum = values.reduce((a, b) => a + b, 0);
  // Nothing allocated anywhere is not a meaningful ratio; share equally.
  const scaled = sum > 0
    ? values.map(v => Math.max(v, 0) * target / sum)
    : values.map(() => target / values.length);
  return apportionIntegers(scaled, target);
}

/**
 * Move one entry to `next` and absorb the difference into the others,
 * preserving the ratios they had in `baseline`.
 *
 * @param {number[]} baseline  Values at the START of the interaction.
 * @param {number} index       Entry being moved.
 * @param {number} next        Its requested new value.
 * @param {number} [total=100] Invariant the set must sum to.
 * @returns {number[]}         Integers summing exactly to `total`.
 */
export function rebalance(baseline, index, next, total = 100) {
  const n = baseline.length;
  if ( !n ) return [];
  // A sole holder has nowhere to push the remainder, so it holds everything.
  if ( n === 1 ) return [total];

  const moved = Math.round(clamp(next, 0, total));
  const remaining = total - moved;

  const others = [];
  for ( let i = 0; i < n; i++ ) if ( i !== index ) others.push(i);
  const othersTotal = others.reduce((sum, i) => sum + Math.max(baseline[i], 0), 0);

  const scaled = others.map(i => (othersTotal > 0
    ? Math.max(baseline[i], 0) * remaining / othersTotal
    // With every other entry at zero there is no ratio to preserve.
    : remaining / others.length));

  const ints = apportionIntegers(scaled, remaining);

  const out = new Array(n);
  out[index] = moved;
  others.forEach((entryIndex, k) => { out[entryIndex] = ints[k]; });
  return out;
}
