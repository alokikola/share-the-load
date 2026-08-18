import {
  MODULE_ID, STRATEGIES, getPileConfig, setPileConfig,
  candidatePiles, carrierCandidates, isPile
} from "../config.mjs";
import { pileWeight, computeShares, carrierCapacity } from "../weight.mjs";
import { syncPile, clearPile, assignedWeight } from "../effects.mjs";
import { rebalance, normalize } from "../allocate.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Badge shown against each candidate, explaining why it is on the list. */
const SOURCE_LABELS = {
  group: "SHARETHELOAD.Source.Group",
  owned: "SHARETHELOAD.Source.Owned",
  configured: "SHARETHELOAD.Source.Configured"
};

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

  /**
   * Slider values captured when the current drag started, or null when idle.
   * @type {{rows: HTMLElement[], index: number, values: number[]}|null}
   */
  #dragBaseline = null;

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
    // An explicit height rather than "auto": with auto the window grows to fit the
    // carrier list and pushes the footer buttons off the bottom. Bounded height plus
    // a scrolling list keeps Save/Apply reachable at any party size.
    position: { width: 560, height: 640 },
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
          capacity: Math.round(carrierCapacity(actor) * 10) / 10,
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

    // Dragging one slider pushes the difference onto the others. Each frame is
    // computed from the values captured when the drag began -- deriving from the
    // live values instead lets rounding error accumulate and the sliders visibly
    // wander while you hold the mouse down.
    root.querySelectorAll('.stl-carrier input[type="range"]').forEach(slider => {
      slider.addEventListener("pointerdown", () => this.#captureBaseline(slider));
      slider.addEventListener("keydown", () => this.#captureBaseline(slider));
      slider.addEventListener("input", event => {
        this.#applyDrag(event.target);
        this.#refreshPreview();
      });
      for ( const done of ["pointerup", "pointercancel", "change", "blur"] ) {
        slider.addEventListener(done, () => { this.#dragBaseline = null; });
      }
      // Wheel is handled by a document-level capture guard in module.mjs, not here:
      // something upstream consumes the event before a listener on the input runs.
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
   * Snapshot the active sliders at the moment an interaction begins. Every frame
   * of the drag is then computed from this, so the result depends only on where
   * the pointer is now -- not on the path it took to get there.
   * @param {HTMLInputElement} slider
   */
  #captureBaseline(slider) {
    const rows = this.#activeRows();
    const index = rows.indexOf(slider.closest(".stl-carrier"));
    this.#dragBaseline = (index < 0) ? null : {
      rows, index, values: rows.map(row => Number(this.#slider(row).value))
    };
  }

  /**
   * Absorb a slider's movement into the other carriers, keeping the set at 100%.
   * @param {HTMLInputElement} slider
   */
  #applyDrag(slider) {
    const row = slider.closest(".stl-carrier");
    // Keyboard adjustment, or a drag that began before this row was active.
    if ( !this.#dragBaseline?.rows.includes(row) ) this.#captureBaseline(slider);
    const baseline = this.#dragBaseline;
    if ( !baseline ) return;

    this.#writeValues(baseline.rows, rebalance(baseline.values, baseline.index, Number(slider.value)));
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

    // A carrier that was just checked holds nothing yet; seed it with an even share
    // so enabling someone actually gives them load.
    const even = 100 / rows.length;
    const seeded = rows.map(row => {
      const value = Number(this.#slider(row).value);
      return value > 0 ? value : even;
    });

    this.#writeValues(rows, normalize(seeded));
    this.#dragBaseline = null;
  }

  /**
   * Push integer values onto the sliders.
   * Values already correct are left alone -- writing back to the slider under the
   * pointer fights the browser's own drag handling and makes the thumb stutter.
   * @param {HTMLElement[]} rows
   * @param {number[]} values
   */
  #writeValues(rows, values) {
    rows.forEach((row, i) => {
      const slider = this.#slider(row);
      if ( Number(slider.value) !== values[i] ) slider.value = values[i];
    });
    this.#updateSum(values.reduce((a, b) => a + b, 0));
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
      if ( strategy === "capacity" ) return Number(row.dataset.cap || 0);
      return 1;
    };

    // Mirrors apportion(): a capacity split is only trusted when every carrier
    // reports a usable figure, otherwise it falls back to an even share.
    const usable = (strategy !== "capacity") || active.every(row => Number(row.dataset.cap) > 0);
    const sum = usable ? active.reduce((acc, row) => acc + basis(row), 0) : 0;
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
