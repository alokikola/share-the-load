/**
 * Tests for the pure split and headroom maths. No Foundry, no DOM.
 *   node test/allocate.test.mjs
 */
import { headroom, fractions, splitWeight } from "../scripts/allocate.mjs";

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

console.log("\nfractions");
check("even ignores bases", fractions("even", [5, 1]), [0.5, 0.5]);
check("capacity is proportional", fractions("capacity", [150, 50]), [0.75, 0.25]);
check("capacity with an unknown bearer falls back to even", fractions("capacity", [150, 0]), [0.5, 0.5]);
check("manual normalises a non-100 total", fractions("manual", [20, 10, 10]), [0.5, 0.25, 0.25]);
check("manual allows a zero share", fractions("manual", [100, 0]), [1, 0]);
check("manual all-zero falls back to even", fractions("manual", [0, 0]), [0.5, 0.5]);
check("unknown strategy falls back to even", fractions("bogus", [3, 1]), [0.5, 0.5]);
check("no bearers", fractions("manual", []), []);

console.log("\nsplitWeight");
check("rounding drift lands on the largest share", splitWeight(100, [1 / 3, 1 / 3, 1 / 3]), [33.34, 33.33, 33.33]);
check("shares always add up to the total", splitWeight(30.4, [60, 75, 120, 11.25].map(c => c / 266.25)).reduce((a, b) => Math.round((a + b) * 10) / 10), 30.4);
check("no bearers", splitWeight(10, []), []);

console.log("\nheadroom");
const T = (e, h, m) => ({ encumbered: e, heavilyEncumbered: h, maximum: m });
{
  // Equal shares; A sits nearer their next threshold, so A binds.
  const r = headroom([
    { name: "A", carried: 40, share: 10, thresholds: T(50, 100, 150) },
    { name: "B", carried: 10, share: 10, thresholds: T(50, 100, 150) }
  ], 20);
  check("names the binding bearer", r.limiting.map(l => l.name), ["A"]);
  check("reports the threshold they hit", r.limiting[0].threshold, "encumbered");
  // A has 50-10-40 = 0 room while absorbing half of anything new.
  check("slack accounts for the bearer's fraction", r.slack, 0);
}
{
  const r = headroom([
    { name: "A", carried: 30, share: 10, thresholds: T(50, 100, 150) },
    { name: "B", carried: 30, share: 10, thresholds: T(50, 100, 150) }
  ], 20);
  check("ties list every affected bearer", r.limiting.map(l => l.name), ["A", "B"]);
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
  // Under on their own (120 of 150), but the pile's 41.67 share drops the limit to
  // 108.33 -- over, with capacity still positive. Mirrors Feng in the live world.
  const r = headroom([
    { name: "Feng", carried: 120, share: 41.67, thresholds: T(50, 100, 150) },
    { name: "Grindar", carried: 0, share: 41.67, thresholds: T(80, 160, 240) }
  ], 125, ["maximum"]);
  assert("the pile's share alone can push a bearer over", r.over === true && r.limiting.length === 1 && r.limiting[0].name === "Feng");
}
{
  // A bearer taking nothing never crosses, so must not bind the result.
  const r = headroom([
    { name: "Idle", carried: 49, share: 0, thresholds: T(50, 100, 150) },
    { name: "Real", carried: 0, share: 10, thresholds: T(50, 100, 150) }
  ], 10);
  check("zero-share bearers are ignored", r.limiting.map(l => l.name), ["Real"]);
}


console.log("\nheadroom - basic vs variant rules");
{
  const T2 = (e, h, m) => ({ encumbered: e, heavilyEncumbered: h, maximum: m });
  // Bearer is past encumbered and heavily encumbered, but well under maximum.
  const bearer = [{ name: "A", carried: 110, share: 10, thresholds: T2(50, 100, 150) }];
  const variant = headroom(bearer, 10, ["encumbered", "heavilyEncumbered", "maximum"]);
  const basic = headroom(bearer, 10, ["maximum"]);
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
