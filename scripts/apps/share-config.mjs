import {
  MODULE_ID, STRATEGIES, getPileConfig, setPileConfig,
  candidatePiles, carrierCandidates, isPile
} from "../config.mjs";

/** Badge shown against each candidate, explaining why it is on the list. */
const SOURCE_LABELS = {
  group: "SHARETHELOAD.Source.Group",
  owned: "SHARETHELOAD.Source.Owned",
  configured: "SHARETHELOAD.Source.Configured"
};
import { pileWeight, computeShares } from "../weight.mjs";
import { syncPile, clearPile, assignedWeight } from "../effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Per-pile carrier configuration. Opened either from the settings menu (no pile
 * preselected) or from a group actor sheet's header controls (pile preselected).
 *
 * In manual mode the sliders behave as a single allocation: they always total
 * 100%, and moving one redistributes the remainder across the others.
 */
export default class ShareConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor(options = {}) {
    super(options);
    this.#pileId = options.pileId ?? candidatePiles()[0]?.id ?? null;
  }

  /** @type {string|null} */
  #pileId;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "share-the-load-config",
    tag: "form",
    classes: ["share-the-load", "standard-form"],
    window: {
      title: "SHARETHELOAD.ConfigTitle",
      icon: "fa-solid fa-weight-hanging",
      resizable: true
    },
    position: { width: 560, height: "auto" },
    form: {
      handler: ShareConfigApp.#onSubmit,
      closeOnSubmit: false,
      submitOnChange: false
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/share-config.hbs` }
  };

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const pile = this.#pileId ? game.actors.get(this.#pileId) : null;
    const config = pile ? getPileConfig(pile) : null;
    const shares = pile ? computeShares(pile) : new Map();
    const candidates = pile ? carrierCandidates(pile) : [];

    // Whether this pile has ever been saved; drives roster pre-checking below.
    const configured = pile ? isPile(pile) : false;
    const checkedFor = ({ actor, source }) =>
      configured ? config.members.includes(actor.id) : (source === "group");

    // A carrier with no stored allocation starts at an even share of whatever
    // set is checked, which on a fresh pile is the group roster rather than [].
    const memberCount = candidates.filter(checkedFor).length;
    const evenDefault = memberCount ? Math.round(100 / memberCount) : 0;

    return {
      piles: candidatePiles().map(p => ({ id: p.id, name: p.name, selected: p.id === this.#pileId })),
      pile,
      config,
      hasPile: !!pile,
      total: pile ? pileWeight(pile, config) : 0,
      hasCurrency: !!pile?.system?.currency,
      currencyRuleActive: game.settings.get("dnd5e", "currencyWeight"),
      strategies: Object.entries(STRATEGIES).map(([value, label]) => ({
        value, label: game.i18n.localize(label), selected: config?.strategy === value
      })),
      carriers: candidates.map(candidate => {
        const { actor, source } = candidate;
        // Until a pile has been saved even once, pre-check its group roster so the
        // common case needs no clicking. After that the stored list wins even when
        // empty, or unchecking everyone would silently re-check the whole roster.
        const isMember = checkedFor(candidate);
        return {
          id: actor.id,
          name: actor.name,
          img: actor.img,
          checked: isMember,
          source,
          sourceLabel: game.i18n.localize(SOURCE_LABELS[source]),
          isNPC: actor.type !== "character",
          // Raw Strength is exposed so the preview can be recalculated client-side
          // without a round trip while the GM is still adjusting the form.
          str: Math.max(actor.system.abilities?.str?.value ?? 10, 1),
          weight: Number(config?.weights?.[actor.id] ?? (isMember ? evenDefault : 0)),
          share: shares.get(actor.id) ?? 0,
          applied: assignedWeight(actor, this.#pileId)
        };
      })
    };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;

    // Switching piles reloads the form against that pile's stored configuration.
    root.querySelector('[name="pileId"]')?.addEventListener("change", event => {
      this.#pileId = event.target.value || null;
      this.render();
    });

    // Strategy is applied as a data attribute rather than by re-rendering, so the
    // sliders can be shown or hidden purely in CSS without discarding unsaved edits.
    root.querySelector('[name="strategy"]')?.addEventListener("change", event => {
      root.querySelector(".stl-body").dataset.strategy = event.target.value;
      this.#renormalize();
      this.#refreshPreview();
    });

    // Adding or removing a carrier changes the denominator, so re-spread to 100%.
    root.querySelectorAll('.stl-carrier input[type="checkbox"]').forEach(box => {
      box.addEventListener("change", () => {
        this.#renormalize();
        this.#refreshPreview();
      });
    });

    // Dragging one slider pushes the difference onto the others.
    root.querySelectorAll('.stl-carrier input[type="range"]').forEach(slider => {
      slider.addEventListener("input", event => {
        this.#rebalance(event.target.closest(".stl-carrier"));
        this.#refreshPreview();
      });
    });

    root.querySelector('[data-action="evenOut"]')?.addEventListener("click", event => {
      event.preventDefault();
      // Zeroing first makes #renormalize reseed every carrier with an even share.
      this.#activeRows().forEach(row => { this.#slider(row).value = 0; });
      this.#renormalize();
      this.#refreshPreview();
    });

    root.querySelector('[data-action="clear"]')?.addEventListener("click", async event => {
      event.preventDefault();
      if ( !this.#pileId ) return;
      await clearPile(this.#pileId);
      ui.notifications.info(game.i18n.localize("SHARETHELOAD.Notify.Cleared"));
      this.render();
    });

    this.#renormalize();
    this.#refreshPreview();
  }

  /* -------------------------------------------- */
  /*  Slider allocation                           */
  /* -------------------------------------------- */

  /** Carrier rows currently sharing this pile. */
  #activeRows() {
    return Array.from(this.element.querySelectorAll(".stl-carrier"))
      .filter(row => row.querySelector('input[type="checkbox"]').checked);
  }

  #slider(row) {
    return row.querySelector('input[type="range"]');
  }

  /**
   * Absorb a slider's change into the other carriers so the set still totals 100%,
   * preserving the ratio between the untouched sliders.
   * @param {HTMLElement} dragged  The carrier row whose slider moved.
   */
  #rebalance(dragged) {
    const rows = this.#activeRows();
    if ( !rows.includes(dragged) ) return;

    const slider = this.#slider(dragged);
    const others = rows.filter(row => row !== dragged);

    // A sole carrier has nowhere to push weight, so it necessarily holds all of it.
    if ( !others.length ) {
      slider.value = 100;
      this.#updateSum(100);
      return;
    }

    const value = Math.clamp(Number(slider.value), 0, 100);
    slider.value = value;

    const target = 100 - value;
    const othersTotal = others.reduce((sum, row) => sum + Number(this.#slider(row).value), 0);
    const values = others.map(row => {
      // With every other slider at zero there is no ratio to preserve; share equally.
      if ( othersTotal <= 0 ) return target / others.length;
      return Number(this.#slider(row).value) * target / othersTotal;
    });

    this.#distribute(others, values, target, value);
  }

  /**
   * Re-spread the active carriers to total exactly 100%, seeding any carrier that
   * has just been enabled and holds no allocation yet.
   */
  #renormalize() {
    // Inactive sliders stay enabled but inert: a disabled input is omitted from
    // form submission, which would discard the stored allocation.
    for ( const row of this.element.querySelectorAll(".stl-carrier") ) {
      const checked = row.querySelector('input[type="checkbox"]').checked;
      row.classList.toggle("stl-inactive", !checked);
    }

    const rows = this.#activeRows();
    if ( !rows.length ) return this.#updateSum(0);

    const even = 100 / rows.length;
    for ( const row of rows ) {
      if ( Number(this.#slider(row).value) <= 0 ) this.#slider(row).value = Math.round(even);
    }

    const total = rows.reduce((sum, row) => sum + Number(this.#slider(row).value), 0);
    const values = rows.map(row => (total > 0 ? Number(this.#slider(row).value) * 100 / total : even));
    this.#distribute(rows, values, 100);
  }

  /**
   * Write integer slider values summing to exactly `target`, parking any rounding
   * remainder on the largest allocation.
   * @param {HTMLElement[]} rows      Rows to write.
   * @param {number[]} values         Unrounded values for those rows.
   * @param {number} target           Total the rows must add up to.
   * @param {number} [held=0]         Allocation held by rows outside this set.
   */
  #distribute(rows, values, target, held = 0) {
    const rounded = values.map(value => Math.round(value));
    const drift = target - rounded.reduce((a, b) => a + b, 0);
    if ( drift !== 0 && rounded.length ) {
      let largest = 0;
      for ( let i = 1; i < rounded.length; i++ ) if ( rounded[i] > rounded[largest] ) largest = i;
      rounded[largest] = Math.clamp(rounded[largest] + drift, 0, 100);
    }
    rows.forEach((row, i) => { this.#slider(row).value = rounded[i]; });
    this.#updateSum(held + rounded.reduce((a, b) => a + b, 0));
  }

  /** Show the live allocation total, which should read 100% at all times. */
  #updateSum(sum) {
    const el = this.element.querySelector(".stl-sum");
    if ( el ) {
      el.textContent = `${sum}%`;
      el.classList.toggle("stl-sum-off", sum !== 100);
    }
  }

  /* -------------------------------------------- */
  /*  Live preview                                */
  /* -------------------------------------------- */

  /**
   * Recalculate the displayed weights from the form's current state.
   * Mirrors weight.mjs#apportion so the numbers track the controls as they move,
   * before anything is saved.
   */
  #refreshPreview() {
    const body = this.element.querySelector(".stl-body");
    if ( !body ) return;
    const total = Number(body.dataset.total ?? 0);
    const strategy = body.dataset.strategy;
    const rows = Array.from(this.element.querySelectorAll(".stl-carrier"));
    const active = this.#activeRows();

    const basis = row => {
      if ( strategy === "manual" ) return Number(this.#slider(row).value);
      if ( strategy === "strength" ) return Number(row.dataset.str || 1);
      return 1;
    };

    const sum = active.reduce((acc, row) => acc + basis(row), 0);
    const fallback = sum <= 0;

    for ( const row of rows ) {
      const checked = row.querySelector('input[type="checkbox"]').checked;
      const out = row.querySelector(".stl-share-weight");
      const pct = row.querySelector(".stl-share-pct");
      if ( !checked || !active.length || (total <= 0) ) {
        out.textContent = "—";
        if ( pct ) pct.textContent = "";
        continue;
      }
      const fraction = fallback ? (1 / active.length) : (basis(row) / sum);
      out.textContent = (Math.round(total * fraction * 10) / 10).toString();
      if ( pct ) pct.textContent = `${Math.round(fraction * 100)}%`;
    }
  }

  /* -------------------------------------------- */
  /*  Submission                                  */
  /* -------------------------------------------- */

  /**
   * Persist the form, and apply immediately when the Apply button was used.
   * @this {ShareConfigApp}
   */
  static async #onSubmit(event, form, formData) {
    const pile = game.actors.get(this.#pileId);
    if ( !pile ) return;

    const data = foundry.utils.expandObject(formData.object);
    const config = {
      enabled: !!data.enabled,
      includeCurrency: !!data.includeCurrency,
      strategy: data.strategy ?? "even",
      // Checkboxes and sliders are named members.<id> / weights.<id> so
      // FormDataExtended expands them into objects keyed by actor id.
      members: Object.entries(data.members ?? {}).filter(([, v]) => v).map(([id]) => id),
      weights: Object.fromEntries(
        Object.entries(data.weights ?? {}).map(([id, v]) => [id, Number(v) || 0])
      )
    };

    await setPileConfig(pile, config);

    if ( event.submitter?.dataset.action === "apply" ) {
      if ( config.enabled ) await syncPile(pile);
      else await clearPile(pile.id);
      ui.notifications.info(game.i18n.format("SHARETHELOAD.Notify.Applied", { pile: pile.name }));
    } else {
      ui.notifications.info(game.i18n.localize("SHARETHELOAD.Notify.Saved"));
    }

    this.render();
  }
}
