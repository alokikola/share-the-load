import { MODULE_ID, isPile, getPileConfig, candidatePiles, BEARER_TYPES } from "./config.mjs";
import { syncPile, syncAll, clearPile, purgeAllEffects } from "./effects.mjs";
import { pileWeight, computeShares } from "./weight.mjs";
import ShareConfigApp from "./apps/share-config.mjs";
import PurgeEffectsMenu from "./apps/purge-menu.mjs";

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

/** Piles whose share maths depend on a given bearer's carrying capacity. */
function pilesWeightedBy(actorId) {
  return candidatePiles().filter(p => {
    const cfg = getPileConfig(p);
    return cfg.enabled && (cfg.strategy === "capacity") && cfg.members.includes(actorId);
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

  // The uninstall path: reachable even with no piles configured, because the
  // effects outlive this module unless something removes them.
  game.settings.registerMenu(MODULE_ID, "purgeMenu", {
    name: "SHARETHELOAD.Setting.Purge.Name",
    hint: "SHARETHELOAD.Setting.Purge.Hint",
    label: "SHARETHELOAD.Setting.Purge.Label",
    icon: "fa-solid fa-broom",
    type: PurgeEffectsMenu,
    restricted: true
  });
});

Hooks.once("ready", async () => {
  game.modules.get(MODULE_ID).api = {
    syncPile, syncAll, clearPile, purgeAllEffects, pileWeight, computeShares,
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
  // Capacity is Strength x size, or cargo for a vehicle; a change to any of them
  // reweights every capacity-based pile the bearer belongs to.
  const sys = changes.system;
  if ( BEARER_TYPES.includes(actor.type) && (sys?.abilities?.str || sys?.traits?.size || sys?.attributes?.capacity) ) {
    for ( const pile of pilesWeightedBy(actor.id) ) queueSync(pile);
  }
});

Hooks.on("deleteActor", actor => {
  if ( isPile(actor) ) clearPile(actor.id);
});

/* -------------------------------------------- */
/*  Loot sheet header control                    */
/* -------------------------------------------- */

/**
 * The actor a sheet is showing, if this GM could configure it as a pile.
 * @param {Application} app
 * @returns {Actor|null}
 */
function pileFromSheet(app) {
  const actor = app?.document ?? app?.actor;
  if ( !game.user.isGM || !(actor instanceof Actor) ) return null;
  // Group actors are the expected pile; anything already configured stays reachable.
  if ( (actor.type !== "group") && !isPile(actor) ) return null;
  return actor;
}

Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const actor = pileFromSheet(app);
  if ( !actor ) return;

  // The hook hands over the live source-of-truth array rather than a copy
  // (foundryvtt#12556), so an unguarded push duplicates the entry each re-render.
  if ( controls.some(c => c.action === ACTION) ) return;

  // ApplicationV2#_renderHeaderControl binds `onClick` straight to the button, so
  // the handler travels with the entry. Nothing is injected into the sheet's own
  // action map, which means this keeps working on sheets that dispatch actions
  // their own way -- Tidy5e and anything else built on a custom renderer.
  controls.push({
    icon: "fa-solid fa-weight-hanging",
    label: "SHARETHELOAD.HeaderControl",
    action: ACTION,
    onClick: () => new ShareConfigApp({ pileId: actor.id }).render(true)
  });
});
