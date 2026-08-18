# Share the Load

Distributes the weight of a party loot actor across chosen carriers, **without moving
the items**. The loot stays on the pile; each carrier gets an Active Effect that
reduces their carrying capacity by their share.

* **Foundry** v13 · **dnd5e** 5.3.x
* Any number of loot piles, each with its own carrier list. A carrier may share
  several piles at once.

## Use

Configure from either **Settings → Share the Load → Configure Carriers**, or the
three-dot header menu on a group actor's sheet.

Carriers are offered in two tiers: the pile's own group roster first, then any actor
a player owns. To let an NPC (a mule, a hireling) share the load, temporarily give
the players ownership of it.

Three split methods: evenly, weighted by Strength score, or manual sliders that
always total 100% — moving one redistributes the rest.

## How it works

Each carrier receives an Active Effect targeting
`system.attributes.encumbrance.bonuses.overall` with the negative of their share.
That field is a documented dnd5e effect target, consumed by `prepareEncumbrance()`
via `simplifyBonus()`.

Effect values are always **explicitly signed** (`-37`, never `37`). The field holds
a roll formula rather than a number: each effect appends another term instead of
being summed, and `simplifyBonus()` evaluates the result and *adds* it to every
threshold. Only a negative value reduces carrying capacity.

Verified on a live world (dnd5e 5.3.3): effects of `-37` and `-12` yield the
formula `-37 - 12`, taking a 150 lb capacity to 101. Shares from several piles
stack correctly as a result.

## Testing

No Foundry install needed for the share maths:

```
node test/weight.test.mjs      # pile weight + share apportionment
node test/allocate.test.mjs    # slider allocation maths
```

`test/console-smoke-test.js` can be pasted into the Foundry console to verify the
effect mechanism against a live world. It cleans up after itself.

## Releasing

Bump `version` in `module.json`, update the `download` URL to the new tag, then:

```
powershell -c "Compress-Archive -Path .\* -DestinationPath ..\share-the-load.zip -Force"
```

Attach **both** `module.json` and `share-the-load.zip` to a GitHub release tagged
`v<version>`. The `manifest` URL uses `releases/latest/download/`, so it stays
stable across releases.
