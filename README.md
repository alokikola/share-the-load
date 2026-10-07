# Share the Load

A Foundry VTT module for dnd5e that spreads the weight of a party loot actor
across the characters carrying it. The items stay on the loot pile; each bearer
gets an Active Effect that reduces their carrying capacity by their share.

For Foundry v13 and v14 with dnd5e 5.x or 6.x (tested on v14 with dnd5e 5.3.3 and
6.0.6). You can have any number of loot piles, each with its own bearers, and a
character can carry shares from more than one pile at a time.

## Install

In Foundry: Setup → Add-on Modules → Install Module, then paste this manifest URL:

```
https://github.com/alokikola/share-the-load/releases/latest/download/module.json
```

## Usage

Open the config from Settings → Share the Load → Configure Bearers, or from the
header menu on a group actor's sheet. Tick the bearers, pick a split method,
then **Save** (or **Apply** to keep the window open). To stop distributing a pile,
use **Remove Effects**, or untick Distribute This Pile and save. Every button has
a tooltip saying exactly what it does.

The top of the window shows the pile's weight: items, coin (with a count of the
coins), and the total, in the world's weight unit. Weights are shown to two
decimal places, so even a handful of coins counts.

Each Save or Apply that changes anything posts a card to chat, so players can see
why their carrying capacity changed: the method, the pile's weight and coin count,
what each bearer carries from the pile (and their shares, on a manual split), and
their encumbrance as their sheet shows it: own gear / new carrying capacity.
Anyone pushed over carrying capacity is shown in red and named at the bottom.
Automatic recalculations stay quiet, so picking up loot never spams chat.

### Bearers

The list shows the pile's group members first, then any other actor a player
owns. Characters, NPCs and vehicles are all eligible — anything dnd5e gives an
encumbrance track. A group actor can be a pile but not a bearer. To let an NPC
like a pack mule carry a share, give the players ownership of it. Hover a
bearer's tag (group, player-owned) for why they are listed.

A saved bearer who later leaves the group stays in the list, marked *no longer
eligible*, so you can still remove their share.

A bearer who already carries for other piles is marked *Bearing 2 other loads*;
hover it to see which piles and how much each takes.

### Split methods

- **Evenly** — equal weight each
- **By carrying capacity** — proportional to what each bearer can hold (Strength
  and size, or cargo for a vehicle)
- **Manually, by shares** — a number of shares per bearer: 2, 1, 1 gives half, a
  quarter and a quarter. The column header shows the total, e.g. *Shares (4)*.

If your party includes anything small, use the capacity split: an even split can
hand a Tiny familiar most of its carrying capacity, where a capacity split gives
it a proportionally tiny share.

The footer shows how much more weight the pile can take before a bearer goes
over a limit, and who that is: "14 more until Owl is over carrying capacity". It
accounts for each bearer's own gear and for loads they carry for other piles.
When everyone reaches their limit at the same moment, it names the party instead.

### Encumbrance settings

The module follows the world's dnd5e encumbrance setting:

- *Normal* is the core carrying capacity rule (2014 and 2024 alike): only
  going over carrying capacity matters, so that is the only limit reported.
- *Variant* is the 2014 variant encumbrance rule. The 2024 rules have no
  equivalent (dnd5e keeps this one as a 2014 reference). It adds the encumbered
  and heavily encumbered tiers, which the footer then reports as well.
- *None* means encumbrance does nothing, and neither can this module. The
  config window warns you if the world is set this way.

Coins only weigh anything when dnd5e's *Apply Currency Weight* rule is on; the
window warns you if it is off. Metric weight units are followed too.

## Uninstalling

Run Settings → Share the Load → Remove All Effects **before** disabling or
uninstalling. The capacity reduction is applied by the dnd5e system, not by
this module, so effects left behind keep working after the module is gone —
with nothing left in the UI to explain or remove them. Pile configurations
survive the purge, so you can re-apply if you reinstall.

## How it works

Each bearer gets an Active Effect adding a negative term to
`system.attributes.encumbrance.bonuses.overall`, a documented dnd5e effect
target. Effects from multiple piles stack. Recalculation runs only on the
acting GM's client and is debounced, so dragging a stack of loot onto the pile
produces one update, not twenty.

## License

MIT. See [LICENSE](LICENSE).
