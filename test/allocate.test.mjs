/**
 * Tests for the pure slider allocation maths. No Foundry, no DOM.
 *   node test/allocate.test.mjs
 */
import { rebalance, normalize, apportionIntegers } from "../scripts/allocate.mjs";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
