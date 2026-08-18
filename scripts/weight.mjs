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
  return pileWeightBreakdown(pile, config).total;
}

/**
 * A pile's weight split into its sources, for display.
 *
 * @param {Actor} pile
 * @param {object} [config]  Pile config; re-read if omitted.
 * @returns {{items: number, coin: number, total: number, itemCount: number, coinCount: number}}
 */
export function pileWeightBreakdown(pile, config) {
  const cfg = config ?? getPileConfig(pile);
  const target = baseUnitFor(pile);

  const items = pile.items
    .filter(item => !item.container)
    .reduce((total, item) => total + (item.system.totalWeightIn?.(target) ?? 0), 0);

  // Coin weight, only when the system's own currencyWeight rule is active.
  let coin = 0;
  let coinCount = 0;
  const currency = pile.system?.currency;
  if ( currency ) {
    coinCount = Object.values(currency).reduce((val, denom) => val + Math.max(denom, 0), 0);
    if ( cfg.includeCurrency && game.settings.get("dnd5e", "currencyWeight") ) {
      const encumbrance = CONFIG.DND5E.encumbrance;
      const unitSystem = game.settings.get("dnd5e", "metricWeightUnits") ? "metric" : "imperial";
      coin = coinCount / encumbrance.currencyPerWeight[unitSystem];
      // Coin weight arrives in the default base unit; convert only if the pile differs.
      const from = encumbrance.baseUnits.default[unitSystem];
      const convert = globalThis.dnd5e?.utils?.convertWeight;
      if ( (from !== target) && convert ) coin = convert(coin, from, target);
    }
  }

  return {
    items: round(items),
    coin: round(coin),
    // Rounded from the unrounded sum, so the parts cannot disagree with the total.
    total: round(items + coin),
    itemCount: pile.items.size,
    coinCount
  };
}

/**
 * A carrier's carrying capacity, BEFORE any share-the-load effect is applied.
 *
 * Deliberately not read from `encumbrance.max`: our own effect reduces that, so
 * weighting by it would feed the output back into the input and oscillate.
 * Reconstructing it from `str x threshold x mod` avoids that, because our effect
 * writes `bonuses` while `mod` derives only from size and `multipliers`.
 *
 * Verified against a live world: str x 15 x mod reproduces `max` exactly for
 * Tiny (mod 0.5), Medium (1) and Large (2) carriers.
 *
 * @param {Actor} actor
 * @returns {number}  Capacity in the actor's base weight unit, or 0 if unknown.
 */
export function carrierCapacity(actor) {
  const unitSystem = game.settings.get("dnd5e", "metricWeightUnits") ? "metric" : "imperial";

  if ( actor.type === "vehicle" ) {
    // Vehicles derive capacity from cargo, not Strength, and dnd5e defaults an
    // unset cargo capacity to Infinity -- which would poison a proportional split.
    const cargo = actor.system.attributes?.capacity?.cargo;
    if ( !Number.isFinite(cargo?.value) || (cargo.value <= 0) ) return 0;
    const target = baseUnitFor(actor);
    const convert = globalThis.dnd5e?.utils?.convertWeight;
    return (cargo.units && convert) ? convert(cargo.value, cargo.units, target) : cargo.value;
  }

  const threshold = CONFIG.DND5E.encumbrance.threshold?.maximum?.[unitSystem] ?? 15;
  const mod = actor.system.attributes?.encumbrance?.mod ?? 1;
  const str = actor.system.abilities?.str?.value ?? 10;
  const capacity = str * threshold * mod;
  return Number.isFinite(capacity) ? capacity : 0;
}

/**
 * A carrier's three encumbrance thresholds BEFORE any share-the-load effect,
 * reconstructed the same way as carrierCapacity and for the same reason.
 *
 * Vehicles are a special case in the system: their thresholds derive from cargo
 * capacity and skip the per-threshold multipliers entirely, so all three levels
 * coincide -- a vehicle is either within capacity or over it.
 *
 * @param {Actor} actor
 * @returns {{encumbered: number, heavilyEncumbered: number, maximum: number}}
 */
export function carrierThresholds(actor) {
  if ( actor.type === "vehicle" ) {
    const cap = carrierCapacity(actor);
    return { encumbered: cap, heavilyEncumbered: cap, maximum: cap };
  }
  const unitSystem = game.settings.get("dnd5e", "metricWeightUnits") ? "metric" : "imperial";
  const config = CONFIG.DND5E.encumbrance.threshold ?? {};
  const mod = actor.system.attributes?.encumbrance?.mod ?? 1;
  const str = actor.system.abilities?.str?.value ?? 10;
  const at = key => str * (config[key]?.[unitSystem] ?? 0) * mod;
  return {
    encumbered: at("encumbered"),
    heavilyEncumbered: at("heavilyEncumbered"),
    maximum: at("maximum")
  };
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
  } else if ( cfg.strategy === "capacity" ) {
    // Proportional to what each carrier can actually hold, so everyone ends up at
    // the same percentage of their limit. This is what keeps a familiar safe: an
    // owl's capacity is a fraction of a PC's, so it receives a fraction of the load
    // rather than an even share that would drive its thresholds negative.
    const weights = carriers.map(carrierCapacity);
    const sum = weights.reduce((a, b) => a + b, 0);
    // A carrier of unknown capacity (0) would silently receive nothing, so only
    // trust this split when every carrier reports a usable figure.
    if ( (sum > 0) && weights.every(w => w > 0) ) {
      return carriers.map((a, i) => total * (weights[i] / sum));
    }
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
