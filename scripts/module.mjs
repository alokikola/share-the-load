import { MODULE_ID, isPile, getPileConfig, candidatePiles, CARRIER_TYPES } from "./config.mjs";
import { syncPile, syncAll, clearPile } from "./effects.mjs";
import { pileWeight, computeShares } from "./weight.mjs";
import ShareConfigApp from "./apps/share-config.mjs";

const ACTION = "shareTheLoad";

/* -------------------------------------------- */
/*  Debounced recompute                          */
/* -------------------------------------------- */

const pending = new Map();

/**
 * Queue a recompute for a pile. Debounced so dragging a stack of loot in
 * produces one sync rather than one per item.
 * @param {Actor} pile
 */
function queueSync(pile) {
  if ( !pile || !isPile(pile) || !getPileConfig(pile).enabled ) return;
  if ( !game.settings.get(MODULE_ID, "autoSync") ) return;
  if ( !pending.has(pile.id) ) {
    pending.set(pile.id, foundry.utils.debounce(() => syncPile(pile), 250));
  }
  pending.get(pile.id)();
}

/** Piles whose share maths depend on a given carrier's Strength. */
function pilesWeightedBy(actorId) {
  return candidatePiles().filter(p => {
    const cfg = getPileConfig(p);
    return cfg.enabled && (cfg.strategy === "strength") && cfg.members.includes(actorId);
  });
}

/* -------------------------------------------- */
/*  Lifecycle                                    */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "autoSync", {
    name: "SHARETHELOAD.Setting.AutoSync.Name",
    hint: "SHARETHELOAD.Setting.AutoSync.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.registerMenu(MODULE_ID, "configMenu", {
    name: "SHARETHELOAD.Setting.Menu.Name",
    hint: "SHARETHELOAD.Setting.Menu.Hint",
    label: "SHARETHELOAD.Setting.Menu.Label",
    icon: "fa-solid fa-weight-hanging",
    type: ShareConfigApp,
    restricted: true
  });
});

Hooks.once("ready", async () => {
  game.modules.get(MODULE_ID).api = {
    syncPile, syncAll, clearPile, pileWeight, computeShares,
    openConfig: pileId => new ShareConfigApp({ pileId }).render(true)
  };
  if ( game.settings.get(MODULE_ID, "autoSync") ) await syncAll();
});

/* -------------------------------------------- */
/*  Change detection                             */
/* -------------------------------------------- */

for ( const hook of ["createItem", "updateItem", "deleteItem"] ) {
  Hooks.on(hook, item => queueSync(item.parent));
}

Hooks.on("updateActor", (actor, changes) => {
  // Pile contents can change without touching items: currency, or our own config.
  if ( isPile(actor) && (changes.system?.currency || changes.flags?.[MODULE_ID]) ) queueSync(actor);
  // A carrier's Strength changing reweights any strength-based pile it belongs to.
  if ( CARRIER_TYPES.includes(actor.type) && changes.system?.abilities?.str ) {
    for ( const pile of pilesWeightedBy(actor.id) ) queueSync(pile);
  }
});

Hooks.on("deleteActor", actor => {
  if ( isPile(actor) ) clearPile(actor.id);
});

/* -------------------------------------------- */
/*  Loot sheet header control                    */
/* -------------------------------------------- */

Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const actor = app.document;
  if ( !game.user.isGM || !(actor instanceof Actor) ) return;
  if ( (actor.type !== "group") && !isPile(actor) ) return;

  // The hook hands over the live source-of-truth array rather than a copy
  // (foundryvtt#12556), so an unguarded push duplicates the entry each re-render.
  if ( controls.some(c => c.action === ACTION) ) return;

  // Header controls dispatch through the application instance's own action map,
  // so register the handler there rather than expecting a callback on the entry.
  app.options.actions ??= {};
  app.options.actions[ACTION] ??= () => new ShareConfigApp({ pileId: actor.id }).render(true);

  controls.push({
    icon: "fa-solid fa-weight-hanging",
    label: "SHARETHELOAD.HeaderControl",
    action: ACTION
  });
});
