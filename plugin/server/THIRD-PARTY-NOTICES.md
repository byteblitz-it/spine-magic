# Third-party notices

SpineMagic's own source code is licensed under the MIT License (see [LICENSE](LICENSE)).
It depends on third-party packages that keep their own licenses. The ones with terms that affect users:

## Spine Runtimes (Esoteric Software)

Packages: `@esotericsoftware/spine-core` (4.0, 4.1, 4.2, 4.3, installed under the aliases
`spine-core-40` … `spine-core-43`), `@esotericsoftware/spine-webgl` 4.2 (alias `spine-webgl-42`),
`@esotericsoftware/spine-pixi-v8`, and the official spine-ts **3.8** build vendored unmodified in
`vendor/spine-3.8/` (`spine-core.js`, `spine-webgl.js`; source commit and hashes in its README, license in
`vendor/spine-3.8/LICENSE`).

`src/core/skel.ts` (the binary `.skel` → JSON converter) is a derivative work of the Spine Runtimes: its
reading logic is ported from spine-ts `SkeletonBinary` (3.8 and 4.2). That file is therefore under the Spine
Runtimes License below, not the MIT License, and so is any build that includes it (the plugin's bundled server
and the web editor build).

Test fixtures in `test/fixtures/official/` (downloaded by `scripts/fetch-spine-examples.mjs`, not committed) are
Esoteric Software's example skeletons.

They are used to validate exports and merged characters and to sample bone animation (Node), and for the
Spine and character previews in the web editor. The repository (vendored 3.8 files) and the web editor build
(`dist-web/`, which bundles the runtimes) redistribute the Spine Runtimes, which must include their license notice:

> Spine Runtimes License Agreement — Copyright (c) 2013-2021, Esoteric Software LLC.
> Integration of the Spine Runtimes into software or otherwise creating derivative works of the Spine
> Runtimes is permitted under the terms and conditions of Section 2 of the Spine Editor License Agreement
> (http://esotericsoftware.com/spine-editor-license). Otherwise, it is permitted to integrate the Spine
> Runtimes into software or otherwise create derivative works of the Spine Runtimes (collectively,
> "Products"), provided that each user of the Products must obtain their own Spine Editor license and
> redistribution of the Products in any form must include this license and copyright notice.

The full text ships with the spine-core packages (e.g. `node_modules/spine-core-43/LICENSE`) and is at
https://esotericsoftware.com/spine-runtimes-license.

**What this means for users:** exported effects are ordinary Spine data. Using them — or the Spine
runtimes — in a product requires a Spine Editor license from Esoteric Software. SpineMagic is not
affiliated with or endorsed by Esoteric Software. "Spine" is a trademark of Esoteric Software LLC.

## Other dependencies

`@modelcontextprotocol/sdk` (MIT), `zod` (MIT), `fflate` (MIT), `pixi.js` (MIT), `react` / `react-dom` (MIT).
Development tools (`typescript`, `vite`, `vitest`, `tsx`) are not shipped.
