# Share the Load

A Foundry VTT module for dnd5e that spreads the weight of a party loot actor
across the characters carrying it. The items stay on the loot pile; each bearer
gets an Active Effect that reduces their carrying capacity by their share.

Requires Foundry v13 and dnd5e 5.3.x. You can have any number of loot piles,
each with its own bearers, and a character can carry shares from more than one
pile at a time.

## Install

In Foundry: Setup → Add-on Modules → Install Module, then paste this manifest URL:

```
https://github.com/alokikola/share-the-load/releases/latest/download/module.json
```

## Usage

Open the config from Settings → Share the Load → Configure Bearers, or from the
header menu on a group actor's sheet. Tick the bearers, pick a split method,
then Save & Apply.

### Bearers

The list shows the pile's group members first, then any other actor a player
owns. Characters, NPCs and vehicles are all eligible — anything dnd5e gives an
encumbrance track. A group actor can be a pile but not a bearer. To let an NPC
like a pack mule carry a share, give the players ownership of it.

A saved bearer who later leaves the group stays in the list, marked *no longer
eligible*, so you can still remove their share.

### Split methods

- **Evenly** — equal weight each
- **By Strength** — proportional to Strength score
- **By capacity** — proportional to what each bearer can actually hold
- **Manual** — sliders that always total 100%

If your party includes anything small, use *By capacity*: an even split can hand
a Tiny familiar most of its carrying capacity, where a capacity split gives it a
proportionally tiny share.

The footer shows how much more weight the pile can absorb before a bearer
crosses an encumbrance threshold, and which bearer that is.

### Encumbrance settings

The module follows the world's dnd5e encumbrance rule. Under *variant*, all
three thresholds apply and distributed weight can push a bearer into the
encumbered tiers. Under *normal*, only maximum capacity has any effect, so
headroom is measured against capacity alone. Under *none*, encumbrance does
nothing and neither can this module; the config warns you if the world is set
that way. The two active rules can name different bearers as the constraint,
so the readout depends on which one your world uses.

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
