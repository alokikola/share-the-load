import {
  MODULE_ID, STRATEGIES, getPileConfig, setPileConfig,
  candidatePiles, bearerCandidates, isPile, trackedLevels
} from "../config.mjs";
import { pileWeightBreakdown, computeShares, bearerThresholds, weightUnitLabel } from "../weight.mjs";
import { syncPile, clearPile, assignedWeight, otherLoads } from "../effects.mjs";
import { headroom, fractions, splitWeight, roundWeight } from "../allocate.mjs";
import { postDistribution } from "../chat.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Badge shown against each candidate, explaining why it is on the list. Each has
 * a short label (SHARETHELOAD.Source.*) and a hover explanation (SourceHint.*).
 */
const SOURCE_KEYS = { group: "Group", owned: "Owned", configured: "Configured" };

/** Threshold names used in the headroom readout. */
const LEVEL_LABELS = {
  encumbered: "SHARETHELOAD.Level.Encumbered",
  heavilyEncumbered: "SHARETHELOAD.Level.HeavilyEncumbered",
  maximum: "SHARETHELOAD.Level.Maximum"
};

/**
 * Per-pile bearer configuration. Opened either from the settings menu (no pile
 * preselected) or from a group actor sheet's header controls (pile preselected).
 *
 * In manual mode each bearer gets a ratio; the preview shows the resulting split.
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
    // An explicit height rather than "auto": with auto the window grows to fit the
    // bearer list and pushes the footer buttons off the bottom. Bounded height plus
    // a scrolling list keeps Save/Apply reachable at any party size.
    position: { width: 560, height: 540 },
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
    const candidates = pile ? bearerCandidates(pile) : [];
    const breakdown = pile ? pileWeightBreakdown(pile, config) : { items: 0, coin: 0, total: 0, coinCount: 0 };

    // Whether this pile has ever been saved; drives roster pre-checking below.
    const unit = pile ? weightUnitLabel(pile) : "";
    const configured = pile ? isPile(pile) : false;
    const checkedFor = ({ actor, source }) =>
      configured ? config.members.includes(actor.id) : (source === "group");

    return {
      piles: candidatePiles().map(p => ({ id: p.id, name: p.name, selected: p.id === this.#pileId })),
      pile,
      config,
      hasPile: !!pile,
      unit,
      total: breakdown.total,
      breakdown,
      // Shown whenever there are coins, even weightless ones, so an excluded hoard is visible.
      showCoin: breakdown.coinCount > 0,
      coinCount: game.i18n.format("SHARETHELOAD.Metric.CoinCount", {
        count: new Intl.NumberFormat(game.i18n.lang).format(breakdown.coinCount ?? 0)
      }),
      hasCurrency: !!pile?.system?.currency,
      currencyRuleActive: game.settings.get("dnd5e", "currencyWeight"),
      encumbranceOff: trackedLevels().length === 0,
      strategies: Object.entries(STRATEGIES).map(([value, label]) => ({
        value, label: game.i18n.localize(label), selected: config?.strategy === value
      })),
      bearers: candidates.map(candidate => {
        const { actor, source } = candidate;
        const thresholds = bearerThresholds(actor);
        const loads = otherLoads(actor, this.#pileId);
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
          sourceLabel: game.i18n.localize(`SHARETHELOAD.Source.${SOURCE_KEYS[source]}`),
          sourceHint: game.i18n.localize(`SHARETHELOAD.SourceHint.${SOURCE_KEYS[source]}`),
          isNPC: actor.type !== "character",
          // Capacity and thresholds are exposed so the preview and headroom can be
          // recalculated client-side while the GM is still adjusting the form.
          carried: roundWeight(actor.system.attributes?.encumbrance?.value ?? 0),
          // Taken by other piles: shown as a tag (listed on hover), and subtracted from
          // every threshold by the headroom readout.
          otherLoad: roundWeight(loads.reduce((sum, l) => sum + l.weight, 0)),
          otherLoadLabel: !loads.length ? null : (loads.length === 1)
            ? game.i18n.localize("SHARETHELOAD.OtherLoads.One")
            : game.i18n.format("SHARETHELOAD.OtherLoads.Many", { count: loads.length }),
          otherLoadTooltip: loads.map(l => `${foundry.utils.escapeHTML(l.name)}: ${roundWeight(l.weight)} ${unit}`).join("<br>"),
          // Exact, not rounded: the preview must split on the same figures as the sync.
          thresholds,
          capacity: roundWeight(thresholds.maximum),
          // Ratios are relative, so an unset one defaults to an equal part.
          weight: Number(config?.weights?.[actor.id] ?? 1),
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
    // ratio inputs can be shown or hidden purely in CSS without discarding edits.
    root.querySelector('[name="strategy"]')?.addEventListener("change", event => {
      root.querySelector(".stl-body").dataset.strategy = event.target.value;
      this.#refreshPreview();
    });

    // Checking a bearer or editing a ratio both change the split.
    root.querySelectorAll(".stl-bearer input").forEach(input => {
      input.addEventListener("input", () => this.#refreshPreview());
    });

    // A focused number input steps its value on wheel, silently re-weighting the
    // party while the GM thinks they are scrolling. Dropping focus first stops the
    // step and lets the scroll reach the bearer list as normal.
    root.querySelectorAll(".stl-ratio").forEach(input => {
      input.addEventListener("wheel", () => input.blur(), { passive: true });
    });

    // Also switches distribution off. Clearing alone would not stick: the next
    // change to the pile's contents would resync and put every effect back.
    root.querySelector('[data-action="clear"]')?.addEventListener("click", async event => {
      event.preventDefault();
      const pile = game.actors.get(this.#pileId);
      if ( !pile ) return;
      await setPileConfig(pile, { ...getPileConfig(pile), enabled: false });
      if ( await clearPile(pile.id) ) await postDistribution(pile);
      else ui.notifications.info(game.i18n.localize("SHARETHELOAD.Notify.Unchanged"));
      this.render();
    });

    this.#refreshPreview();
  }

  /** Bearer rows currently sharing this pile. */
  #activeRows() {
    return Array.from(this.element.querySelectorAll(".stl-bearer"))
      .filter(row => row.querySelector('input[type="checkbox"]').checked);
  }

  /* -------------------------------------------- */
  /*  Live preview                                */
  /* -------------------------------------------- */

  /**
   * Recalculate the displayed weights from the form's current state, using the
   * same allocate.mjs#fractions as the real sync so the numbers track the
   * controls as they move, before anything is saved.
   */
  #refreshPreview() {
    const body = this.element.querySelector(".stl-body");
    if ( !body ) return;
    const total = Number(body.dataset.total ?? 0);
    const strategy = body.dataset.strategy;
    const active = this.#activeRows();
    const split = fractions(strategy, active.map(row =>
      (strategy === "capacity") ? Number(row.dataset.max) : Number(row.querySelector(".stl-ratio").value)
    ));

    // Total shares among ticked bearers: what "2 of 4" in the chat card counts from.
    const shareTotal = active.reduce((sum, row) => sum + Math.max(Number(row.querySelector(".stl-ratio").value) || 0, 0), 0);
    this.element.querySelector(".stl-share-total").textContent = Math.round(shareTotal * 100) / 100;

    const weights = splitWeight(total, split);

    for ( const row of this.element.querySelectorAll(".stl-bearer") ) {
      const i = active.indexOf(row);
      const out = row.querySelector(".stl-share-weight");
      const pct = row.querySelector(".stl-share-pct");
      if ( (i < 0) || (total <= 0) ) {
        out.textContent = "—";
        pct.textContent = "";
        continue;
      }
      out.textContent = weights[i].toString();
      pct.textContent = `${Math.round(split[i] * 100)}%`;
    }

    this.#refreshHeadroom(active, total, weights);
  }

  /**
   * Report how much more the pile can take before a bearer crosses a threshold.
   * Recomputed alongside the share preview so it tracks the controls live.
   * @param {HTMLElement[]} active  Checked bearer rows.
   * @param {number} total          Pile weight.
   * @param {number[]} weights      Each active row's share of the pile.
   */
  #refreshHeadroom(active, total, weights) {
    const el = this.element.querySelector(".stl-headroom");
    if ( !el ) return;

    const bearers = active.map((row, i) => {
      const other = Number(row.dataset.other || 0);
      return {
        name: row.querySelector(".stl-bearer-name").textContent.trim(),
        carried: Number(row.dataset.carried || 0),
        share: weights[i],
        // Full thresholds less whatever other piles already take from this bearer.
        thresholds: {
          encumbered: Number(row.dataset.enc || 0) - other,
          heavilyEncumbered: Number(row.dataset.heavy || 0) - other,
          maximum: Number(row.dataset.max || 0) - other
        }
      };
    });

    const result = headroom(bearers, total, trackedLevels());
    el.classList.toggle("stl-headroom-over", result.over);
    if ( !result.over && (result.slack === null) ) {
      el.textContent = "";
      return;
    }

    const { limiting } = result;
    const levelOf = entry => game.i18n.localize(LEVEL_LABELS[entry.threshold]);
    const list = names => new Intl.ListFormat(game.i18n.lang, { type: "conjunction" }).format(names);

    // A capacity split always ends in a tie -- everyone reaches their limit at the
    // same moment -- so naming each bearer would just spell out the whole party.
    const party = (bearers.length > 1) && (limiting.length === bearers.length);
    const mixed = new Set(limiting.map(e => e.threshold)).size > 1;

    let form = party ? "Party" : (limiting.length === 1 ? "One" : "Many");
    let who = list(limiting.map(e => e.name));
    // Ties that cross different lines (variant rule only) label each name instead.
    if ( mixed ) {
      form = "Mixed";
      who = list(limiting.map(e => `${e.name} (${levelOf(e)})`));
    }

    el.textContent = game.i18n.format(`SHARETHELOAD.Headroom.${result.over ? "Over" : "Room"}.${form}`, {
      amount: result.slack, who, level: levelOf(limiting[0])
    });
  }

  /* -------------------------------------------- */
  /*  Submission                                  */
  /* -------------------------------------------- */

  /**
   * Persist the form and apply it to every bearer. Save then closes; Apply stays open.
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
      // Checkboxes and ratios are named members.<id> / weights.<id> so
      // FormDataExtended expands them into objects keyed by actor id.
      members: Object.entries(data.members ?? {}).filter(([, v]) => v).map(([id]) => id)
    };

    // Prune allocations down to actual bearers. Every rendered row submits a
    // ratio, so without this the flag accumulates an entry for every actor
    // ever offered as a candidate -- mostly defaults, plus stale figures for anyone
    // plucked from the list. Only members are ever read, so the rest is dead weight.
    config.weights = Object.fromEntries(
      Object.entries(data.weights ?? {})
        .filter(([id]) => config.members.includes(id))
        .map(([id, v]) => [id, Number(v) || 0])
    );

    await setPileConfig(pile, config);

    // Always apply explicitly. The flag write only triggers the automatic resync
    // when something actually changed, and never clears a disabled pile.
    // The chat card is posted only when something changed, so Apply twice is quiet.
    const changed = config.enabled ? await syncPile(pile) : (await clearPile(pile.id)) > 0;
    if ( changed ) await postDistribution(pile);
    else ui.notifications.info(game.i18n.localize("SHARETHELOAD.Notify.Unchanged"));

    // Save closes, Apply keeps the window open -- the usual settings convention.
    if ( event.submitter?.dataset.action === "save" ) this.close();
    else this.render();
  }
}
