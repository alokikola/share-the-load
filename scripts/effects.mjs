import { MODULE_ID, CHANGE_KEY, candidatePiles, getPileConfig, isPile } from "./config.mjs";
import { computeShares } from "./weight.mjs";

const ICON = "icons/containers/bags/sack-simple-leather-brown.webp";

/** Only the acting GM may write effects, so all clients converge on one author. */
function isActingGM() {
  return game.users.activeGM?.isSelf === true;
}

/** Find our effect for a given pile on a given carrier. */
function findEffect(actor, pileId) {
  return actor.effects.find(e => e.getFlag(MODULE_ID, "pile") === pileId);
}

/**
 * The Active Effect change value.
 *
 * ALWAYS explicitly signed. This is a roll formula, not a number: dnd5e routes
 * these through a FormulaField, and each additional effect is appended as another
 * term rather than summed arithmetically. `simplifyBonus()` then evaluates the
 * whole string and ADDS it to each encumbrance threshold, so only a negative
 * value reduces carrying capacity -- an unsigned "37" would raise it.
 *
 * Verified against a live world (dnd5e 5.3.3): two effects of "-37" and "-12"
 * produce the formula "-37 - 12", dropping a 150 lb capacity to 101. Shares from
 * several piles therefore stack correctly.
 */
function changeValue(weight) {
  return `-${weight}`;
}

function effectData(pile, weight) {
  return {
    name: game.i18n.format("SHARETHELOAD.EffectName", { pile: pile.name }),
    img: ICON,
    origin: pile.uuid,
    disabled: false,
    changes: [{
      key: CHANGE_KEY,
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: changeValue(weight),
      priority: 20
    }],
    description: game.i18n.format("SHARETHELOAD.EffectDescription", { pile: pile.name, weight }),
    flags: { [MODULE_ID]: { pile: pile.id, weight } }
  };
}

/**
 * Bring every carrier's effect in line with one pile's current contents.
 * Carriers no longer configured have their effect for this pile removed.
 * @param {Actor} pile
 */
export async function syncPile(pile) {
  if ( !isActingGM() || !pile ) return;
  const shares = computeShares(pile);

  // Deliberately unfiltered by actor type: `shares` already contains only valid
  // carriers, and sweeping every actor is what removes a stale effect from someone
  // who is no longer eligible to carry at all.
  for ( const actor of game.actors ) {
    const existing = findEffect(actor, pile.id);
    const owed = shares.get(actor.id) ?? 0;

    if ( owed > 0 ) {
      if ( !existing ) await actor.createEmbeddedDocuments("ActiveEffect", [effectData(pile, owed)]);
      // Skip no-op updates so item shuffling doesn't spam the database.
      else if ( existing.getFlag(MODULE_ID, "weight") !== owed ) {
        await existing.update(effectData(pile, owed));
      }
    } else if ( existing ) {
      await existing.delete();
    }
  }
}

/** Recompute every configured pile. */
export async function syncAll() {
  for ( const pile of candidatePiles() ) {
    // candidatePiles() also offers up group actors that have never been set up;
    // those must be skipped, since the default config reads as enabled.
    if ( isPile(pile) && getPileConfig(pile).enabled ) await syncPile(pile);
  }
}

/**
 * Remove all effects sourced from a pile, regardless of current configuration.
 * Used when a pile is disabled or deleted.
 * @param {string} pileId
 */
export async function clearPile(pileId) {
  if ( !isActingGM() ) return;
  for ( const actor of game.actors ) {
    const existing = findEffect(actor, pileId);
    if ( existing ) await existing.delete();
  }
}

/** Weight currently assigned to a carrier by a given pile, for display. */
export function assignedWeight(actor, pileId) {
  return findEffect(actor, pileId)?.getFlag(MODULE_ID, "weight") ?? 0;
}
