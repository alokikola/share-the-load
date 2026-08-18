import { getPileConfig, CARRIER_TYPES } from "./config.mjs";

/**
 * Resolve the weight unit an actor's encumbrance is measured in, mirroring
 * AttributesFields.prepareEncumbrance so our sums are directly comparable.
 * @param {Actor} actor
 * @returns {string}
 */
function baseUnitFor(actor) {
  const cfg = CONFIG.DND5E.encumbrance;
  const baseUnits = cfg.baseUnits[actor.type] ?? cfg.baseUnits.default;
  const unitSystem = game.settings.get("dnd5e", "metricWeightUnits") ? "metric" : "imperial";
  return baseUnits[unitSystem];
}

/**
 * Total weight held by a loot pile, in the pile's own base weight unit.
 *
 * Mirrors the system's own calculation, including the `!item.container` filter:
 * items stowed inside a container are already counted by that container's
 * totalWeightIn(), so including them directly would double-count them.
 *
 * @param {Actor} pile
 * @param {object} [config]  Pile config; re-read if omitted.
 * @returns {number}
 */
export function pileWeight(pile, config) {
  const cfg = config ?? getPileConfig(pile);
  const target = baseUnitFor(pile);

  let weight = pile.items
    .filter(item => !item.container)
    .reduce((total, item) => total + (item.system.totalWeightIn?.(target) ?? 0), 0);

  // Coin weight, only when the system's own currencyWeight rule is active.
  const currency = pile.system?.currency;
  if ( cfg.includeCurrency && currency && game.settings.get("dnd5e", "currencyWeight") ) {
    const encumbrance = CONFIG.DND5E.encumbrance;
    const unitSystem = game.settings.get("dnd5e", "metricWeightUnits") ? "metric" : "imperial";
    const numCoins = Object.values(currency).reduce((val, denom) => val + Math.max(denom, 0), 0);
    let coinWeight = numCoins / encumbrance.currencyPerWeight[unitSystem];
    // Coin weight arrives in the default base unit; convert only if the pile differs.
    const from = encumbrance.baseUnits.default[unitSystem];
    const convert = globalThis.dnd5e?.utils?.convertWeight;
    if ( (from !== target) && convert ) coinWeight = convert(coinWeight, from, target);
    weight += coinWeight;
  }

  return round(weight);
}

/**
 * Split a pile's weight across its configured carriers.
 *
 * Strategies:
 *  - `even`     equal shares.
 *  - `strength` proportional to raw Strength score. Deliberately NOT proportional
 *               to `encumbrance.max`: our own effect reduces that value, so using
 *               it would feed the output back into the input and oscillate.
 *  - `manual`   proportional to the per-carrier weights set with the sliders.
 *               Stored as relative numbers and normalised here, so the whole pile
 *               is always accounted for even if the sliders don't total 100.
 *
 * @param {Actor} pile
 * @returns {Map<string, number>}  Carrier actor id -> weight owed, in the pile's base unit.
 */
export function computeShares(pile) {
  const cfg = getPileConfig(pile);
  const shares = new Map();
  if ( !cfg.enabled ) return shares;

  const carriers = cfg.members
    .map(id => game.actors.get(id))
    .filter(a => CARRIER_TYPES.includes(a?.type));
  if ( !carriers.length ) return shares;

  const total = pileWeight(pile, cfg);
  if ( total <= 0 ) return shares;

  const raw = apportion(total, carriers, cfg);

  // Rounding to a tenth loses or gains a little; push the drift onto the largest
  // share so the distributed weights always add up to the pile's actual weight.
  const rounded = raw.map(round);
  const drift = round(total - rounded.reduce((a, b) => a + b, 0));
  if ( drift !== 0 ) {
    let largest = 0;
    for ( let i = 1; i < rounded.length; i++ ) if ( rounded[i] > rounded[largest] ) largest = i;
    rounded[largest] = round(rounded[largest] + drift);
  }

  carriers.forEach((actor, i) => shares.set(actor.id, rounded[i]));
  return shares;
}

/**
 * Unrounded share for each carrier, per the configured strategy.
 * @param {number} total
 * @param {Actor[]} carriers
 * @param {object} cfg
 * @returns {number[]}
 */
function apportion(total, carriers, cfg) {
  if ( cfg.strategy === "manual" ) {
    const weights = carriers.map(a => Math.max(Number(cfg.weights?.[a.id] ?? 0), 0));
    const sum = weights.reduce((a, b) => a + b, 0);
    // All sliders at zero is not a meaningful instruction; fall back to even.
    if ( sum > 0 ) return carriers.map((a, i) => total * (weights[i] / sum));
  } else if ( cfg.strategy === "strength" ) {
    const weights = carriers.map(a => Math.max(a.system.abilities?.str?.value ?? 10, 1));
    const sum = weights.reduce((a, b) => a + b, 0);
    return carriers.map((a, i) => total * (weights[i] / sum));
  }
  return carriers.map(() => total / carriers.length);
}

/** Round to one decimal, matching the precision the system displays. */
function round(value) {
  return Math.round(value * 10) / 10;
}
