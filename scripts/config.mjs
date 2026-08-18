/** Module-wide constants. */
export const MODULE_ID = "share-the-load";

/**
 * The dnd5e Active Effect target. Documented in the dnd5e Active Effect Guide:
 * `bonuses.overall` is added to all three encumbrance thresholds equally.
 * Consumed by AttributesFields.prepareEncumbrance via simplifyBonus(), which
 * evaluates the string as a roll formula -- so values MUST be explicitly signed.
 */
export const CHANGE_KEY = "system.attributes.encumbrance.bonuses.overall";

/** Distribution strategies. */
export const STRATEGIES = {
  even: "SHARETHELOAD.Strategy.Even",
  strength: "SHARETHELOAD.Strategy.Strength",
  manual: "SHARETHELOAD.Strategy.Manual"
};

/** Default per-pile configuration. */
export const DEFAULT_CONFIG = {
  enabled: true,
  members: [],
  strategy: "even",
  /** Manual mode: actorId -> relative share, normalised at calculation time. */
  weights: {},
  includeCurrency: true
};

/**
 * Read a pile's configuration, merged over defaults.
 * @param {Actor} pile
 * @returns {object}
 */
export function getPileConfig(pile) {
  const stored = pile?.getFlag(MODULE_ID, "config") ?? {};
  return foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_CONFIG), stored, { inplace: false });
}

/**
 * Persist a pile's configuration.
 * @param {Actor} pile
 * @param {object} config
 */
export function setPileConfig(pile, config) {
  return pile.setFlag(MODULE_ID, "config", config);
}

/** Has this actor ever been configured as a pile? */
export function isPile(actor) {
  return actor?.getFlag?.(MODULE_ID, "config") !== undefined;
}

/**
 * Actors eligible to act as loot piles: group actors, plus anything already configured.
 * @returns {Actor[]}
 */
export function candidatePiles() {
  return game.actors.filter(a => (a.type === "group") || isPile(a));
}

/**
 * Actor types that can carry a share. These are exactly the types whose data
 * models call AttributesFields.prepareBaseEncumbrance, and so are the only ones
 * with the `encumbrance.bonuses` field our effect targets. A group actor has no
 * encumbrance at all, so it can be a pile but never a carrier.
 */
export const CARRIER_TYPES = ["character", "npc", "vehicle"];

/**
 * Actor ids on a group actor's roster.
 * dnd5e stores these as an array of objects with a ForeignDocumentField, which
 * resolves to a Document when available and leaves the raw id when it does not.
 * @param {Actor} pile
 * @returns {string[]}
 */
export function groupMemberIds(pile) {
  const members = pile?.system?.members ?? [];
  return members
    .map(m => m?.actor?.id ?? m?.actor)
    .filter(id => typeof id === "string");
}

/**
 * Actors offered as carriers for a pile, in priority order:
 *   1. `group`      on the pile's own group roster
 *   2. `owned`      any eligible actor a player owns (temporarily granting a
 *                   player ownership of an NPC is how you add a mule or hireling)
 *   3. `configured` already saved on this pile but no longer matching either tier
 *
 * Tier 3 is not a convenience: without it, a carrier who leaves the group and
 * loses ownership keeps their encumbrance effect with no row in the UI to
 * uncheck, leaving an invisible penalty only the console could clear.
 *
 * @param {Actor} pile
 * @returns {Array<{actor: Actor, source: string}>}
 */
export function carrierCandidates(pile) {
  const found = new Map();
  const add = (actor, source) => {
    if ( !actor || !CARRIER_TYPES.includes(actor.type) || found.has(actor.id) ) return;
    found.set(actor.id, { actor, source });
  };

  for ( const id of groupMemberIds(pile) ) add(game.actors.get(id), "group");
  for ( const actor of game.actors ) if ( actor.hasPlayerOwner ) add(actor, "owned");
  for ( const id of getPileConfig(pile).members ) add(game.actors.get(id), "configured");

  const tier = { group: 0, owned: 1, configured: 2 };
  return Array.from(found.values()).sort((a, b) =>
    (tier[a.source] - tier[b.source]) || a.actor.name.localeCompare(b.actor.name)
  );
}
