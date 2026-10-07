import { MODULE_ID, STRATEGIES, getPileConfig } from "./config.mjs";
import { computeShares, pileWeightBreakdown, weightUnitLabel } from "./weight.mjs";
import { roundWeight } from "./allocate.mjs";

/**
 * Announce a pile's distribution in chat, so players can see why their carrying
 * capacity changed. Only posted from explicit GM actions in the config window --
 * never from automatic resyncs, which would flood the log with every pickup.
 *
 * Call after the pile has been synced, so each bearer's capacity is current.
 * @param {Actor} pile
 */
export async function postDistribution(pile) {
  const cfg = getPileConfig(pile);
  const manual = cfg.strategy === "manual";
  const shares = [...computeShares(pile)].map(([id, weight]) => ({ actor: game.actors.get(id), weight }));
  const totalShares = shares.reduce((sum, { actor }) => sum + Number(cfg.weights?.[actor.id] ?? 0), 0);

  // Coins are named either way: "incl." when they add weight, "not counted" when the
  // pile excludes them or the currency weight rule is off, so nobody wonders.
  const breakdown = pileWeightBreakdown(pile, cfg);
  const count = new Intl.NumberFormat(game.i18n.lang).format(breakdown.coinCount);
  const coins = !breakdown.coinCount ? null : game.i18n.format(
    breakdown.coin > 0 ? "SHARETHELOAD.Chat.CoinsIncluded" : "SHARETHELOAD.Chat.CoinsExcluded", { count }
  );

  const rows = shares.map(({ actor, weight }) => {
    const { max: after = 0, value: carried = 0 } = actor.system.attributes?.encumbrance ?? {};
    return {
      name: actor.name,
      shares: manual ? game.i18n.format("SHARETHELOAD.Chat.SharesOf", {
        count: Number(cfg.weights?.[actor.id] ?? 0), total: totalShares
      }) : null,
      weight,
      // Mirrors the sheet's Encumbrance bar: their own gear over their new capacity.
      load: roundWeight(carried),
      after: roundWeight(after),
      // The system's own test: what they carry, own gear included, exceeds the limit.
      // A vehicle with no cargo capacity set reports null; it has no limit to exceed.
      over: Number.isFinite(after) && (carried > after)
    };
  });
  // Same wording as the config footer: "Owl is over carrying capacity".
  const level = game.i18n.localize("SHARETHELOAD.Level.Maximum");
  const overLines = rows.filter(r => r.over).map(r => game.i18n.format("SHARETHELOAD.Headroom.Over.One", { who: r.name, level }));

  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/chat-card.hbs`, {
    pile: pile.name,
    stopped: !cfg.enabled,
    total: breakdown.total,
    coins,
    unit: weightUnitLabel(pile),
    method: game.i18n.localize(STRATEGIES[cfg.strategy] ?? STRATEGIES.even),
    manual,
    rows,
    overLines
  });

  return ChatMessage.implementation.create({ content, speaker: ChatMessage.getSpeaker({ actor: pile }) });
}
