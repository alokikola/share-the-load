# Contributing

## Tests

The share maths and slider allocation are pure functions with no Foundry
dependencies, so they run under plain Node with no install step:

```
node test/weight.test.mjs      # pile weight, apportionment, carrier eligibility
node test/allocate.test.mjs    # slider allocation, headroom, encumbrance rules
```

`test/console-smoke-test.js` can be pasted into the Foundry console to check the
effect mechanism against a live world. It creates two temporary effects, checks the
numbers, and deletes them again.

## Releasing

Bump `version` in `module.json` **and** the tag in its `download` URL. If those two
disagree, Foundry's update check silently sees no new version and the module will
not update — with no error anywhere.

```
git archive --format=zip --output=../share-the-load.zip HEAD
```

`git archive` rather than a plain zip of the folder, so `.git` and untracked files
stay out of the release.

Attach **both** `module.json` and `share-the-load.zip` to a GitHub release tagged
`v<version>`. Both are needed: the `manifest` URL points at
`releases/latest/download/module.json`, and Foundry reads the `download` field from
it to fetch the archive.

## After updating a live world

Connected clients can keep the previous stylesheet, which renders the new template
against old CSS. Hard refresh before judging how anything looks.
