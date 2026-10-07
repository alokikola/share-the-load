# Contributing

## Tests

The share maths and headroom are pure functions with no Foundry
dependencies, so they run under plain Node with no install step:

```
node test/weight.test.mjs      # pile weight, coin count, shares, capacity split
node test/allocate.test.mjs    # split fractions, rounding, headroom, encumbrance rules
```

No Node? The Foundry desktop app can run them itself:

```
ELECTRON_RUN_AS_NODE=1 "<Foundry install>/Foundry Virtual Tabletop.exe" test/weight.test.mjs
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

`git archive` rather than a plain zip of the folder, so `.git`, untracked files and
the `export-ignore` paths (tests, this file) stay out of the release.

Attach **both** `module.json` and `share-the-load.zip` to a GitHub release tagged
`v<version>`. Both are needed: the `manifest` URL points at
`releases/latest/download/module.json`, and Foundry reads the `download` field from
it to fetch the archive.

### Trying a build on a live world first

Publish it as a GitHub **prerelease** with a version that sorts between the current
release and the next one (e.g. `1.0.90` before `1.1.0`). Prereleases never count as
"latest", so the public manifest keeps serving the current release. Install on the
server from the prerelease's own manifest URL
(`releases/download/v<version>/module.json`), test, then delete the prerelease once
the real release ships. Avoid suffixes like `-test`: Foundry compares versions part
by part, and a suffix can confuse it.

## After updating a live world

Connected clients can keep the previous stylesheet, which renders the new template
against old CSS. Hard refresh before judging how anything looks.
