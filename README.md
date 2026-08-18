# Share the Load

Spread the weight of a party loot actor across the characters, **without moving the
items**. The loot stays on the pile; each carrier gets an Active Effect that reduces
their carrying capacity by their share.

* **Foundry** v13 · **dnd5e** 5.3.x
* Any number of loot piles, each with its own carrier list
* A character can carry shares from several piles at once

## Install

Foundry → **Setup → Add-on Modules → Install Module**, and paste this into the
Manifest URL box:

```
https://github.com/alokikola/share-the-load/releases/latest/download/module.json
```

## Using it

Open the config from either:

* **Settings → Share the Load → Configure Carriers**, or
* the **three-dot header menu** on a group actor's sheet

Tick the carriers, choose how to split, then **Save & Apply**.

### Who can carry

Candidates are offered in two tiers: the pile's own **group roster** first, then any
actor a **player owns**. To let an NPC share the load — a mule, a hireling, a
summoned bear — temporarily give the players ownership of it.

Characters, NPCs and vehicles are all eligible, since those are the actor types
dnd5e gives an encumbrance track. A group actor can be a pile but never a carrier.

Anyone already saved on a pile keeps appearing even if they later leave the group
and lose ownership, flagged as *no longer eligible*. Without that they would keep an
effect with no row left to untick it.

### Splitting the weight

| Method | Behaviour |
| --- | --- |
| **Evenly** | Equal weight each |
| **By Strength** | Proportional to Strength score |
| **By capacity** | Proportional to what each carrier can actually hold |
| **Manual** | Sliders, always totalling 100% |

**By capacity** is usually what you want when the party includes anything small.
An owl with 22.5 lb of capacity takes an even share of 15.2 lb from a 76 lb pile —
two thirds of everything it can carry — where a capacity split gives it 2.3.

Manual sliders are a single allocation: move one and the others absorb the
difference, keeping their proportions to each other. **Even Out** resets them.

### Reading the panel

The footer reports how much more the pile can absorb before someone crosses a
threshold, and who. It accounts for each carrier's *fraction* of new loot rather
than simply who is nearest a line — a carrier on a 10% share approaches their limit
five times slower than one on 50%. Ties list everyone.

The header row shows each carrier's capacity, their share, and its percentage. The
line above the list splits the pile's weight into items and coin.

## It depends on your encumbrance rule

dnd5e has three settings: **none**, **normal** and **variant**.

* **variant** — all three thresholds apply, with speed penalties. Distributed weight
  can push someone to *encumbered* or *heavily encumbered*.
* **normal** — only maximum capacity does anything. The intermediate thresholds are
  still calculated but have no mechanical effect, so headroom is measured against
  capacity alone.
* **none** — nothing consumes encumbrance and this module cannot affect play. The
  config warns you if the world is set this way.

The difference is not cosmetic. On one real party the two readings differed by five
times and named different carriers as the constraint.

## Removing it

**Settings → Share the Load → Remove All Effects** before disabling or uninstalling.

This matters. The effect targets a dnd5e field, so the *system* applies it — not
this module. Disable the module without clearing first and every carrier keeps their
reduced capacity permanently, with nothing left in the interface to explain why.

Pile configurations survive the purge, so you can re-apply afterwards.

## How it works

Each carrier receives an Active Effect targeting
`system.attributes.encumbrance.bonuses.overall` with the negative of their share.
That field is a documented dnd5e effect target, consumed by `prepareEncumbrance()`
via `simplifyBonus()`.

Values are always **explicitly signed** (`-37`, never `37`). The field holds a roll
formula rather than a number: each effect appends another term instead of being
summed, and the result is added to every threshold, so only a negative value reduces
capacity. Verified on a live world — effects of `-37` and `-12` yield `-37 - 12`,
taking a 150 lb capacity to 101. Shares from several piles stack correctly as a
result.

Capacity is reconstructed as `str × threshold × mod` rather than read from
`encumbrance.max`, because this module *reduces* that value and reading it back
would feed the output into its own input.

Recalculation runs only on the acting GM, debounced, so dragging in a stack of loot
produces one update rather than twenty.

## Licence

MIT. See [LICENSE](LICENSE).
