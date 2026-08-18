import { purgeAllEffects } from "../effects.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;

/**
 * The "Remove All Effects" settings entry.
 *
 * A settings menu expects an Application, but this entry is a button rather than a
 * form: registerMenu instantiates the class and calls render(), so the work happens
 * there and no window is ever opened.
 */
export default class PurgeEffectsMenu extends ApplicationV2 {

  /** @override */
  async render() {
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize("SHARETHELOAD.Purge.Title"), icon: "fa-solid fa-broom" },
      content: `<p>${game.i18n.localize("SHARETHELOAD.Purge.Prompt")}</p>`,
      modal: true,
      rejectClose: false
    });
    if ( !confirmed ) return this;

    const removed = await purgeAllEffects();
    ui.notifications.info(game.i18n.format("SHARETHELOAD.Purge.Done", { count: removed }));
    return this;
  }
}
