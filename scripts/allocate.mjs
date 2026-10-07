/**
 * Pure maths: the split itself, and headroom. No DOM, no Foundry globals --
 * see test/allocate.test.mjs.
 */

/**
 * Each bearer's fraction of the pile under a split method. The single source of
 * truth for the split: weight.mjs uses it to write effects, and the config form
 * uses it for the live preview, so the two cannot disagree.
 *
 *  - `even`     equal fractions; `bases` is ignored.
 *  - `capacity` proportional to carrying capacity. Only trusted when every bearer
 *               reports a usable figure -- one of unknown capacity (0) would
 *               silently receive nothing -- so otherwise it falls back to even.
 *  - `manual`   proportional to the GM's per-bearer ratios. Normalised, so they need not
 *               total anything in particular; all zero falls back to even.
 *
 * @param {string} strategy
 * @param {number[]} bases  Per-bearer capacity or manual ratio.
 * @returns {number[]}      Fractions summing to 1.
 */
export function fractions(strategy, bases) {
  const n = bases.length;
  const even = () => bases.map(() => 1 / n);
  if ( (strategy !== "capacity") && (strategy !== "manual") ) return even();
  if ( (strategy === "capacity") && !bases.every(b => b > 0) ) return even();
  const clamped = bases.map(b => Math.max(Number(b) || 0, 0));
  const sum = clamped.reduce((a, b) => a + b, 0);
  return sum > 0 ? clamped.map(b => b / sum) : even();
}

/**
 * Round a weight to two decimal places. The one place weight precision is set: a
 * single coin weighs 0.02 lb, so a tenth would hide small hoards entirely.
 * @param {number} value
 * @returns {number}
 */
export function roundWeight(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Turn fractions into rounded weights that still add up to the total.
 * Rounding each share loses or gains a little; the drift goes onto the largest
 * share. Shared by the real sync and the form preview, so both show the same
 * figures down to the last decimal.
 *
 * @param {number} total
 * @param {number[]} fracs  From fractions().
 * @returns {number[]}
 */
export function splitWeight(total, fracs) {
  const out = fracs.map(f => roundWeight(total * f));
  const drift = roundWeight(total - out.reduce((a, b) => a + b, 0));
  if ( drift && out.length ) {
    let largest = 0;
    for ( let i = 1; i < out.length; i++ ) if ( out[i] > out[largest] ) largest = i;
    out[largest] = roundWeight(out[largest] + drift);
  }
  return out;
}

/** Every threshold level, in the order a bearer crosses them. */
export const ALL_LEVELS = ["encumbered", "heavilyEncumbered", "maximum"];

/**
 * How much more weight the pile can absorb before some bearer crosses their next
 * encumbrance threshold, and who that bearer is.
 *
 * A bearer only absorbs their fraction of new loot, so the pile can grow by
 * `their headroom / their fraction` before they cross. The binding bearer is
 * whoever yields the smallest such figure -- not simply whoever is nearest a
 * threshold, since a bearer taking a small share approaches it slowly.
 *
 * "Next threshold" means the first one they have NOT already crossed. Someone
 * already heavily encumbered by their own gear is measured against `maximum`,
 * so their pre-existing state is not reported as an alarm.
 *
 * @param {Array<{name: string, carried: number, share: number,
 *                thresholds: {encumbered: number, heavilyEncumbered: number, maximum: number}}>} bearers
 * @param {number} total  Current pile weight.
 * @param {string[]} [levels=ALL_LEVELS]  Levels this world actually applies. Under
 *   the basic rule only `maximum` does anything, so reporting a bearer as nearing
 *   "heavily encumbered" would name a line with no mechanical effect.
 * @returns {{slack: number|null, limiting: Array<{name: string, threshold: string}>, over: boolean}}
 */
export function headroom(bearers, total, levels = ALL_LEVELS) {
  const over = [];
  const constrained = [];
  if ( !levels.length ) return { slack: null, limiting: [], over: false };

  const last = levels[levels.length - 1];

  for ( const c of bearers ) {
    // Thresholds shift down by whatever this bearer already shoulders.
    const level = levels.find(k => c.carried <= (c.thresholds[k] - c.share));
    if ( !level ) {
      over.push({ name: c.name, threshold: last });
      continue;
    }
    const room = (c.thresholds[level] - c.share) - c.carried;
    // A bearer taking no share never crosses as the pile grows.
    const fraction = total > 0 ? c.share / total : 0;
    if ( fraction <= 0 ) continue;
    constrained.push({ name: c.name, threshold: level, slack: room / fraction });
  }

  if ( over.length ) return { slack: null, limiting: over, over: true };
  if ( !constrained.length ) return { slack: null, limiting: [], over: false };

  const min = Math.min(...constrained.map(c => c.slack));
  return {
    slack: roundWeight(min),
    // Ties are reported in full rather than picking an arbitrary winner.
    limiting: constrained.filter(c => (c.slack - min) < 0.005).map(({ name, threshold }) => ({ name, threshold })),
    over: false
  };
}
