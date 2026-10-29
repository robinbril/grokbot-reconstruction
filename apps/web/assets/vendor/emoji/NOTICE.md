# Emoji data provenance

The entry data are derived from the four hashed data assets shipped with Grok Bot 0.71.2. Their package manifest declares `emojibase-data` version `17.0.0`. The extraction preserves the observed native index construction; no private service is required.

`LICENSE-emojibase-MIT.txt` is the unmodified LICENSE inside the official npm package `emojibase-data@17.0.0`, retrieved from https://registry.npmjs.org/emojibase-data/-/emojibase-data-17.0.0.tgz. npm integrity was checked before extraction. Official package metadata: https://registry.npmjs.org/emojibase-data/17.0.0.

Package gitHead: `a5fc630a91ca42cddf3f4a66492965600fd3bce8`.

Package integrity: `sha512-Yvgb5AWoHViHV/gq1qr5ZAarcBip+B27/ZLRsUJkbgAEaLlZ/fof9g882LTpmEpyhBNEC0m2SEmItljHsTygjA==`.

`NOTICE-Unicode.txt` is the unmodified current Unicode License V3 retrieved from https://www.unicode.org/license.txt. It is included as an additional Unicode data notice, not as a claim that this exact 2026 notice was shipped by the application.

Only emoji data are included. This notice does not license proprietary application code, branding, or private services. `manifest.json` records file hashes and exact extraction counts.

The four default exports were compared structurally, with object key order ignored and array order preserved, to respectively `en/compact.json`, `en/shortcodes/iamcal.json`, `en/shortcodes/emojibase.json`, and `nl/messages.json` in the verified npm tarball. All four comparisons passed. The dataset provenance is therefore stronger than a matching package declaration alone.

Regenerate locally with `node apps/web/scripts/vendor-composer-emoji.mjs`; verify determinism with the same command followed by `--check`. Supply another extracted native asset location with `--source=/absolute/path/to/assets`. Inputs are hash-pinned before module evaluation.
