import { getPileConfig, BEARER_TYPES } from "./config.mjs";
import { fractions, splitWeight, roundWeight as round } from "./allocate.mjs";

/** "metric" or "imperial", per the system's weight unit setting. */
function unitSystem() {
  return game.settings.get("dnd5e", "metricWeightUnits") ? "metric" : "imperial";
}

/**
 * Resolve the weight unit an actor's encumbrance is measured in, mirroring
 * AttributesFields.prepareEncumbrance so our sums are directly comparable.
 * @param {Actor} actor
 * @returns {string}
 */
function baseUnitFor(actor) {
  const cfg = CONFIG.DND5E.encumbrance;
  const baseUnits = cfg.baseUnits[actor.type] ?? cfg.baseUnits.default;
  return baseUnits[unitSystem()];
}

/** The abbreviation for an actor's base weight unit, e.g. "lb". */
export function weightUnitLabel(actor) {
  const unit = baseUnitFor(actor);
  return CONFIG.DND5E.weightUnits?.[unit]?.abbreviation ?? unit;
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
 * @returns {{items: number, coin: number, total: number, coinCount: number}}
 */
export function pileWeightBreakdown(pile, config) {
  const cfg = config ?? getPileConfig(pile);
  const target = baseUnitFor(pile);

  const items = pile.items
    .filter(item => !item.container)
    .reduce((total, item) => total + (item.system.totalWeightIn?.(target) ?? 0), 0);

  // Coins are counted regardless, so the config can show what is being left out;
  // they only weigh anything when the system's own currencyWeight rule is active.
  let coin = 0;
  const currency = pile.system?.currency ?? {};
  const coinCount = Object.values(currency).reduce((val, denom) => val + Math.max(Number(denom) || 0, 0), 0);
  if ( coinCount && cfg.includeCurrency && game.settings.get("dnd5e", "currencyWeight") ) {
    const encumbrance = CONFIG.DND5E.encumbrance;
    const units = unitSystem();
    coin = coinCount / encumbrance.currencyPerWeight[units];
    // Coin weight arrives in the default base unit; convert only if the pile differs.
    const from = encumbrance.baseUnits.default[units];
    const convert = globalThis.dnd5e?.utils?.convertWeight;
    if ( (from !== target) && convert ) coin = convert(coin, from, target);
  }

  return {
    items: round(items),
    coin: round(coin),
    // Rounded from the unrounded sum, so the parts cannot disagree with the total.
    total: round(items + coin),
    coinCount
  };
}

/**
 * A bearer's three encumbrance thresholds BEFORE any share-the-load effect.
 *
 * Deliberately not read from `encumbrance.max`: our own effect reduces that, so
 * weighting by it would feed the output back into the input and oscillate.
 * Reconstructing it from `str x threshold x mod` avoids that, because our effect
 * writes `bonuses` while `mod` derives only from size and `multipliers`.
 *
 * Verified against a live world: str x 15 x mod reproduces `max` exactly for
 * Tiny (mod 0.5), Medium (1) and Large (2) bearers.
 *
 * Vehicles are a special case in the system: their thresholds derive from cargo
 * capacity and skip the per-threshold multipliers entirely, so all three levels
 * coincide -- a vehicle is either within capacity or over it.
 *
 * @param {Actor} actor
 * @returns {{encumbered: number, heavilyEncumbered: number, maximum: number}}
 *   In the actor's base weight unit; 0 where unknown.
 */
export function bearerThresholds(actor) {
  if ( actor.type === "vehicle" ) {
    const cap = vehicleCapacity(actor);
    return { encumbered: cap, heavilyEncumbered: cap, maximum: cap };
  }
  const units = unitSystem();
  const config = CONFIG.DND5E.encumbrance.threshold ?? {};
  const mod = actor.system.attributes?.encumbrance?.mod ?? 1;
  const str = actor.system.abilities?.str?.value ?? 10;
  // Each base limit is rounded to a tenth, exactly as AttributesFields does before
  // adding bonuses -- otherwise metric limits like 11.25 kg disagree with the sheet.
  const at = key => {
    const value = Math.round(str * (config[key]?.[units] ?? 0) * mod * 10) / 10;
    return Number.isFinite(value) ? value : 0;
  };
  return {
    encumbered: at("encumbered"),
    heavilyEncumbered: at("heavilyEncumbered"),
    maximum: at("maximum")
  };
}

/**
 * Vehicles derive capacity from cargo, not Strength. An unset cargo capacity
 * reads as null (or Infinity, per the system source), either of which would
 * poison a proportional split, so it reports 0.
 * @param {Actor} actor
 * @returns {number}
 */
function vehicleCapacity(actor) {
  const cargo = actor.system.attributes?.capacity?.cargo;
  if ( !Number.isFinite(cargo?.value) || (cargo.value <= 0) ) return 0;
  const convert = globalThis.dnd5e?.utils?.convertWeight;
  return (cargo.units && convert) ? convert(cargo.value, cargo.units, baseUnitFor(actor)) : cargo.value;
}

/**
 * Split a pile's weight across its configured bearers, per the pile's strategy.
 * See allocate.mjs#fractions for the strategies themselves.
 *
 * @param {Actor} pile
 * @returns {Map<string, number>}  Bearer actor id -> weight owed, in the pile's base unit.
 */
export function computeShares(pile) {
  const cfg = getPileConfig(pile);
  const shares = new Map();
  if ( !cfg.enabled ) return shares;

  const bearers = cfg.members
    .map(id => game.actors.get(id))
    .filter(a => BEARER_TYPES.includes(a?.type));
  if ( !bearers.length ) return shares;

  const total = pileWeight(pile, cfg);
  if ( total <= 0 ) return shares;

  const bases = bearers.map(a => (cfg.strategy === "capacity") ? bearerThresholds(a).maximum : (cfg.weights?.[a.id] ?? 0));
  const rounded = splitWeight(total, fractions(cfg.strategy, bases));

  bearers.forEach((actor, i) => shares.set(actor.id, rounded[i]));
  return shares;
}
