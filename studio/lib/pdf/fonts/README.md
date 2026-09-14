# PDF fonts

The exporter embeds subsets of these bundled fonts, so exported documents do not
depend on the reader's installed fonts or an external font service. All three
families are under the SIL Open Font License 1.1.

## Barlow Condensed

Shot numerals, kickers, panel letters, rail type labels, rail endpoints and the
page number. Downloaded on 15 September 2026 from the
[google/fonts](https://github.com/google/fonts) repository, `main` branch at
commit `809e4d8b8d7e9364a914909bb777679606c178b8`, path `ofl/barlowcondensed/`.
License: `Barlow-LICENSE.txt`.

- `BarlowCondensed-Light.ttf`
  SHA-256: `2c37e1e6b5feb71d38a42e6180d2e2f4ca1aad22cfecbd017430f3863deba67d`.
- `BarlowCondensed-Medium.ttf`
  SHA-256: `262bd143292ce479ee0cd09a42b47ab173fca8e9c6eb5ed0b5c8a845bc371d17`.
- `BarlowCondensed-SemiBold.ttf`
  SHA-256: `7b619d14bc2327509a9ef32b0890f709626f7ecc9ff61191c2a4314c5499d2d9`.

## Barlow

Panel descriptions, camera notes, cover meta and rail label descriptions.
Downloaded on 15 September 2026 from the same repository and commit, path
`ofl/barlow/`. License: `Barlow-LICENSE.txt`, taken from `ofl/barlow/OFL.txt`,
SHA-256: `186d750eb496a4c17a76385f82be6aea2ac1cf2de074a811d63786cf374ea73f`.

- `Barlow-Regular.ttf`
  SHA-256: `95aa02c7c43096e0dd44d787ba6216864a67157e402adab59b35572e0c1577ea`.
- `Barlow-Medium.ttf`
  SHA-256: `f8906f762cb73dca441da034bc363b2d8e2e68bc10d5c05e58717646c20cc4b4`.

## Courier Prime

Dialogue. Courier Prime Regular, version 3.018, from the
[Courier Prime project](https://github.com/quoteunquoteapps/CourierPrime).
Downloaded on 12 September 2026 from `fonts/ttf/CourierPrime-Regular.ttf` on the
upstream `master` branch. License: `CourierPrime-LICENSE.txt`.

- `CourierPrime-Regular.ttf`
  SHA-256: `72f793376f8e2841656bf21d77a5de010f2929bd6956a22ee848ad0c7eb978af`.

## Notes

None of these faces carries U+2192 (→). The `CONTINUES` kicker draws its arrow
as a vector instead, alongside the rail arrowheads, which are vectors anyway.

Noto Sans was removed on 15 September 2026 when the exporter was rebuilt to the
version 2 design. Nothing in the project imports it.

These font choices apply to the PDF. The dialogue editor uses the computer's
Courier New font through CSS.
