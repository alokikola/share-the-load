/**
 * Tests for the pure slider allocation maths. No Foundry, no DOM.
 *   node test/allocate.test.mjs
 */
import { rebalance, normalize, apportionIntegers, headroom } from "../scripts/allocate.mjs";

let pass = 0, fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if ( ok ) { pass++; console.log(`  ok   ${label}`); }
  else {
    fail++;
    console.log(`  FAIL ${label}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`);
  }
}

function assert(label, condition, detail = "") {
  if ( condition ) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
}

const sum = a => a.reduce((x, y) => x + y, 0);

console.log("\napportionIntegers");
// Largest remainder wins the spare unit: .34 beats the two .33s.
check("splits 100 across 3 with no drift", apportionIntegers([33.33, 33.33, 33.34], 100), [33, 33, 34]);
check("already-integer input is untouched", apportionIntegers([50, 30, 20], 100), [50, 30, 20]);
check("empty input", apportionIntegers([], 100), []);
assert("ties break deterministically",
  JSON.stringify(apportionIntegers([33.33, 33.33, 33.33], 99)) === JSON.stringify(apportionIntegers([33.33, 33.33, 33.33], 99)));

console.log("\nnormalize");
check("three equal entries total exactly 100", normalize([50, 50, 50]), [34, 33, 33]);
assert("normalized set sums to 100", sum(normalize([7, 3, 90, 1])) === 100);
check("all zero falls back to an even split", normalize([0, 0, 0, 0]), [25, 25, 25, 25]);
check("single entry takes everything", normalize([5]), [100]);

console.log("\nrebalance - invariants");
{
  const base = [40, 30, 30];
  const out = rebalance(base, 0, 60);
  check("moved entry lands on its requested value", out[0], 60);
  assert("set still totals 100", sum(out) === 100, `got ${JSON.stringify(out)}`);
  check("others keep their 1:1 ratio", [out[1], out[2]], [20, 20]);
}
{
  const out = rebalance([60, 20, 20], 0, 40);
  check("others keep ratio when the moved entry decreases", [out[1], out[2]], [30, 30]);
}
{
  const out = rebalance([50, 30, 20], 0, 50);
  check("ratios preserved unevenly (30:20 of 50)", [out[1], out[2]], [30, 20]);
}
check("a sole entry always holds the whole total", rebalance([100], 0, 40), [100]);
check("request above the total is clamped", rebalance([50, 50], 0, 150), [100, 0]);
check("request below zero is clamped", rebalance([50, 50], 0, -20), [0, 100]);
check("all others at zero share the remainder equally", rebalance([100, 0, 0], 0, 40), [40, 30, 30]);

console.log("\nrebalance - stability (the anti-wiggle property)");
{
  // Every frame of a drag is derived from the drag's STARTING values. Sweeping the
  // dragged slider must therefore move the others smoothly and never oscillate.
  const base = [20, 50, 30];
  let bad = [];
  let prev = null;
  for ( let v = 0; v <= 100; v++ ) {
    const out = rebalance(base, 0, v);
    if ( sum(out) !== 100 ) bad.push(`sum!=100 at ${v}: ${JSON.stringify(out)}`);
    if ( prev ) {
      // As the dragged entry rises, no other entry may rise with it.
      if ( (out[1] > prev[1]) || (out[2] > prev[2]) ) {
        bad.push(`non-monotonic at ${v}: ${JSON.stringify(prev)} -> ${JSON.stringify(out)}`);
      }
    }
    prev = out;
  }
  assert("full 0-100 sweep stays exact and monotonic", bad.length === 0, bad.slice(0, 3).join("\n         "));
}
{
  const base = [20, 50, 30];
  const a = rebalance(base, 1, 63);
  const b = rebalance(base, 1, 63);
  check("identical inputs give identical output", a, b);
}
{
  // Returning to the starting value must restore the starting split exactly.
  const base = [25, 25, 25, 25];
  const moved = rebalance(base, 2, 70);
  const back = rebalance(base, 2, 25);
  check("dragging away and back restores the original", back, base);
  assert("the intermediate state was still valid", sum(moved) === 100);
}


console.log("\nheadroom");
const T = (e, h, m) => ({ encumbered: e, heavilyEncumbered: h, maximum: m });
{
  // Equal shares; A sits nearer their next threshold, so A binds.
  const r = headroom([
    { name: "A", carried: 40, share: 10, thresholds: T(50, 100, 150) },
    { name: "B", carried: 10, share: 10, thresholds: T(50, 100, 150) }
  ], 20);
  check("names the binding carrier", r.limiting.map(l => l.name), ["A"]);
  check("reports the threshold they hit", r.limiting[0].threshold, "encumbered");
  // A has 50-10-40 = 0 room while absorbing half of anything new.
  check("slack accounts for the carrier's fraction", r.slack, 0);
}
{
  const r = headroom([
    { name: "A", carried: 30, share: 10, thresholds: T(50, 100, 150) },
    { name: "B", carried: 30, share: 10, thresholds: T(50, 100, 150) }
  ], 20);
  check("ties list every affected carrier", r.limiting.map(l => l.name), ["A", "B"]);
}
{
  // Already heavily encumbered by their own gear: measured against maximum.
  const r = headroom([{ name: "A", carried: 110, share: 10, thresholds: T(50, 100, 150) }], 10);
  check("levels already crossed are skipped", r.limiting[0].threshold, "maximum");
  assert("a pre-existing state is not raised as an alarm", r.over === false);
}
{
  const r = headroom([{ name: "A", carried: 200, share: 10, thresholds: T(50, 100, 150) }], 10);
  assert("past maximum reports overloaded", r.over === true && r.limiting[0].name === "A");
}
{
  // A carrier taking nothing never crosses, so must not bind the result.
  const r = headroom([
    { name: "Idle", carried: 49, share: 0, thresholds: T(50, 100, 150) },
    { name: "Real", carried: 0, share: 10, thresholds: T(50, 100, 150) }
  ], 10);
  check("zero-share carriers are ignored", r.limiting.map(l => l.name), ["Real"]);
}


console.log("\nheadroom - basic vs variant rules");
{
  const T2 = (e, h, m) => ({ encumbered: e, heavilyEncumbered: h, maximum: m });
  // Carrier is past encumbered and heavily encumbered, but well under maximum.
  const carrier = [{ name: "A", carried: 110, share: 10, thresholds: T2(50, 100, 150) }];
  const variant = headroom(carrier, 10, ["encumbered", "heavilyEncumbered", "maximum"]);
  const basic = headroom(carrier, 10, ["maximum"]);
  check("variant measures against maximum once the others are crossed", variant.limiting[0].threshold, "maximum");
  check("basic measures against maximum only", basic.limiting[0].threshold, "maximum");

  // Below every threshold: variant warns about `encumbered`, basic about capacity.
  const light = [{ name: "B", carried: 10, share: 10, thresholds: T2(50, 100, 150) }];
  check("variant names the first line crossed", headroom(light, 10, ["encumbered", "heavilyEncumbered", "maximum"]).limiting[0].threshold, "encumbered");
  check("basic ignores lines the world does not apply", headroom(light, 10, ["maximum"]).limiting[0].threshold, "maximum");
  assert("basic reports more room than variant",
    headroom(light, 10, ["maximum"]).slack > headroom(light, 10, ["encumbered", "heavilyEncumbered", "maximum"]).slack);
}
{
  const T2 = (e, h, m) => ({ encumbered: e, heavilyEncumbered: h, maximum: m });
  const r = headroom([{ name: "A", carried: 10, share: 10, thresholds: T2(50, 100, 150) }], 10, []);
  assert("no tracked levels yields nothing to report", r.slack === null && r.limiting.length === 0 && r.over === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
