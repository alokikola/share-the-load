/**
 * Exercises ShareTheLoad's weight + share maths against stubbed Foundry globals.
 * No Foundry install required: weight.mjs only touches globals inside functions.
 */

/* ---------- minimal Foundry stubs ---------- */

function deepClone(v) {
  return (v === null || typeof v !== "object") ? v : JSON.parse(JSON.stringify(v));
}

function mergeObject(original, other = {}) {
  const out = deepClone(original);
  for ( const [k, v] of Object.entries(other) ) {
    if ( v && (typeof v === "object") && !Array.isArray(v) && out[k] && (typeof out[k] === "object") ) {
      out[k] = mergeObject(out[k], v);
    } else out[k] = deepClone(v);
  }
  return out;
}

globalThis.foundry = { utils: { deepClone, mergeObject } };

const SETTINGS = { metricWeightUnits: false, currencyWeight: true };
const ACTORS = new Map();

globalThis.game = {
  settings: { get: (ns, key) => SETTINGS[key] },
  actors: { get: id => ACTORS.get(id) }
};

globalThis.CONFIG = {
  DND5E: {
    encumbrance: {
      baseUnits: { default: { imperial: "lb", metric: "kg" } },
      currencyPerWeight: { imperial: 50, metric: 110 }
    }
  }
};

/* ---------- fixtures ---------- */

const MODULE_ID = "share-the-load";

function makeCarrier(id, name, str = 10, type = "character") {
  const actor = { id, name, type, system: { abilities: { str: { value: str } } } };
  ACTORS.set(id, actor);
  return actor;
}

/** @param {Array<{w:number, qty?:number, container?:string}>} items */
function makePile(items, config, currency = null) {
  return {
    id: "pile1",
    name: "Group Loot 1",
    type: "group",
    system: currency ? { currency } : {},
    items: items.map((it, i) => ({
      id: `i${i}`,
      container: it.container ?? null,
      system: { totalWeightIn: () => it.w * (it.qty ?? 1) }
    })),
    getFlag: (ns, key) => (ns === MODULE_ID && key === "config") ? config : undefined
  };
}

/* ---------- harness ---------- */

let pass = 0, fail = 0;
const approx = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if ( ok ) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`); }
}

function checkNear(label, actual, expected) {
  const ok = approx(actual, expected);
  if ( ok ) { pass++; console.log(`  ok   ${label}  (${actual})`); }
  else { fail++; console.log(`  FAIL ${label}\n         expected ~${expected}\n         actual    ${actual}`); }
}

const { pileWeight, computeShares } = await import(
  "../scripts/weight.mjs"
);

const shareList = pile => [...computeShares(pile).values()];
const sum = arr => Math.round(arr.reduce((a, b) => a + b, 0) * 10) / 10;

/* ---------- tests ---------- */

makeCarrier("a", "Alice", 16);
makeCarrier("b", "Bob", 10);
makeCarrier("c", "Cai", 8);
makeCarrier("mule", "Mule", 14, "npc");

console.log("\npileWeight");
{
  const pile = makePile([{ w: 10 }, { w: 5, qty: 3 }], { enabled: true, members: [] });
  checkNear("sums item weights x quantity", pileWeight(pile), 25);
}
{
  // A packed item is already counted by its container's totalWeightIn().
  const pile = makePile([{ w: 30 }, { w: 7, container: "bag1" }], { enabled: true, members: [] });
  checkNear("excludes items inside a container", pileWeight(pile), 30);
}
{
  const pile = makePile([{ w: 10 }], { enabled: true, members: [], includeCurrency: true }, { gp: 500 });
  checkNear("adds coin weight at 50/lb", pileWeight(pile), 20);
}
{
  const pile = makePile([{ w: 10 }], { enabled: true, members: [], includeCurrency: false }, { gp: 500 });
  checkNear("skips coin weight when disabled", pileWeight(pile), 10);
}

console.log("\ncomputeShares - even");
{
  const pile = makePile([{ w: 100 }], { enabled: true, strategy: "even", members: ["a", "b", "c"] });
  const s = shareList(pile);
  check("100 across 3 has no rounding drift", sum(s), 100);
  console.log(`       -> ${JSON.stringify(s)}`);
}

console.log("\ncomputeShares - strength");
{
  const pile = makePile([{ w: 68 }], { enabled: true, strategy: "strength", members: ["a", "b", "c"] });
  const s = shareList(pile);
  check("weights by STR 16/10/8", sum(s), 68);
  checkNear("strongest carries most", s[0], 68 * 16 / 34);
  console.log(`       -> ${JSON.stringify(s)}`);
}

console.log("\ncomputeShares - manual");
{
  const pile = makePile([{ w: 100 }], {
    enabled: true, strategy: "manual", members: ["a", "b", "c"],
    weights: { a: 50, b: 30, c: 20 }
  });
  check("honours 50/30/20", shareList(pile), [50, 30, 20]);
}
{
  const pile = makePile([{ w: 100 }], {
    enabled: true, strategy: "manual", members: ["a", "b", "c"],
    weights: { a: 0, b: 0, c: 0 }
  });
  check("all-zero falls back to even", sum(shareList(pile)), 100);
}
{
  // Stored percentages that no longer total 100 must still distribute the whole pile.
  const pile = makePile([{ w: 90 }], {
    enabled: true, strategy: "manual", members: ["a", "b"],
    weights: { a: 20, b: 10 }
  });
  check("normalises a non-100 total", shareList(pile), [60, 30]);
}

console.log("\ncomputeShares - eligibility + guards");
{
  const pile = makePile([{ w: 60 }], { enabled: true, strategy: "even", members: ["a", "mule"] });
  check("player-owned NPC is a valid carrier", shareList(pile), [30, 30]);
}
{
  const pile = makePile([{ w: 60 }], { enabled: true, strategy: "even", members: ["a", "ghost"] });
  check("missing actor id is skipped", shareList(pile), [60]);
}
{
  const pile = makePile([{ w: 60 }], { enabled: false, strategy: "even", members: ["a", "b"] });
  check("disabled pile distributes nothing", shareList(pile), []);
}
{
  const pile = makePile([], { enabled: true, strategy: "even", members: ["a", "b"] });
  check("empty pile distributes nothing", shareList(pile), []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
