/**
 * Paste into the Foundry browser console (F12) as GM.
 *
 * Verifies the module's core assumption WITHOUT installing anything: that
 * `system.attributes.encumbrance.bonuses.overall` is a live Active Effect target,
 * and that signed values from multiple effects stack into one valid formula.
 *
 * Creates two temporary effects and deletes them again. Nothing is left behind.
 */
(async () => {
  const KEY = "system.attributes.encumbrance.bonuses.overall";
  const ADD = CONST.ACTIVE_EFFECT_MODES.ADD;

  // Change this to a specific name if you'd rather target a particular PC.
  const actor = game.actors.find(a => (a.type === "character") && a.hasPlayerOwner)
    ?? game.actors.find(a => a.type === "character");
  if ( !actor ) return console.error("No character actor found.");

  const max = () => actor.system.attributes.encumbrance.max;
  const results = [];
  const made = [];
  const record = (label, actual, expected) => {
    const ok = Math.abs(actual - expected) < 0.51;
    results.push({ check: label, expected, actual, ok: ok ? "PASS" : "FAIL" });
  };

  console.log(`%cShareTheLoad smoke test on: ${actor.name}`, "font-weight:bold");
  const base = max();
  console.log("baseline encumbrance.max:", base, actor.system.attributes.encumbrance.thresholds);

  const effect = (name, value) => ({
    name, changes: [{ key: KEY, mode: ADD, value, priority: 20 }]
  });

  try {
    // 1. A single signed value must lower every threshold by that amount.
    made.push(...await actor.createEmbeddedDocuments("ActiveEffect", [effect("STL test A", "-37")]));
    record("one effect of -37 lowers max by 37", max(), base - 37);

    // 2. The claim this module rests on: dnd5e delegates ADD on a FormulaField to
    //    core, appending each as a further term. "-37" and "-12" must evaluate to -49.
    made.push(...await actor.createEmbeddedDocuments("ActiveEffect", [effect("STL test B", "-12")]));
    record("second effect of -12 stacks to -49 total", max(), base - 49);

    console.log("raw bonus formula after both effects:",
      JSON.stringify(actor.system.attributes.encumbrance.bonuses.overall));
  } catch ( err ) {
    console.error("Smoke test threw:", err);
  } finally {
    for ( const e of made ) await e.delete();
    record("cleanup restores the original max", max(), base);
  }

  console.table(results);
  const failed = results.filter(r => r.ok === "FAIL");
  console.log(failed.length
    ? `%c${failed.length} check(s) FAILED - the effect approach needs revisiting.`
    : "%cAll checks passed - the encumbrance effect mechanism works on this world.",
    `font-weight:bold;color:${failed.length ? "#c0392b" : "#27ae60"}`);
})();
