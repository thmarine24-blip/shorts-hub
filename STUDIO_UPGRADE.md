# Creator Studio upgrade

No build step. Deploy `index.html`, `js/` and `styles/` together through the existing
GitHub Pages setup. Push the matching pipeline changes first, including the new
`plan.yml` workflow. Do not upload the local verification outputs or any secrets.

The dark/gold responsive studio adds three modes, remembered creative defaults,
manual script import, background footage discovery, editable shots, reusable media,
cost confirmation and reliable failed-attempt deletion. Mapbox is outside the main
flow. Paid visual generation is off by default and requires explicit approval.

**Create → story → review shots → render → share.** The existing **Make my video**
button skips shot review while the backend still builds a visual plan automatically.
Use **Media library** to add uploaded demonstration clips, reference images, music
or effects. Releases hold bytes; the pipeline media branch holds small metadata.
Removing a library item does not destroy its original release file.

Run `node tests/studio.test.cjs`, `node tests/operations.test.cjs`, and `node --check`
on all three JavaScript modules. Serve locally with `python -m http.server 8769`.
Browser verification covered direct JSON import (fences/trailing commas), preserved
beat metadata, shot controls, disconnected error states and phone-width layout.

See the pipeline's **STUDIO_UPGRADE.md** for the complete schema, architecture audit,
source ranking, optional `PIXABAY_API_KEY` / `FAL_KEY`, budget safeguards, tests and
remaining live checks. Existing GitHub, Pexels, Gemini and YouTube settings remain
compatible. Gemini is optional for imported scripts.

Live Actions dispatch, Releases upload and billed generation have not been exercised
by the implementation tests. No changes were pushed or deployed automatically.
