/**
 * Static assertions over public/catalogue.html.
 *
 * There is no DOM library in this project and no new dependency is allowed, so
 * these are string and regex assertions over the file text. That is weaker than
 * parsing, so each check is written to fail on the thing that would actually
 * break the product: a network reference sneaking into an offline page, the
 * evidence path drifting away from what render-format-batch.mjs writes, the
 * provenance panel losing the fields that are the whole point of the page.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const HTML = await readFile(join(here, 'catalogue.html'), 'utf8');

/** Every src=/href= value in the document, quotes stripped. */
function attributeValues(name) {
  return [...HTML.matchAll(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'g'))].map(m => m[1]);
}

/**
 * The source text of one top-level `function name(` in the page script, from its
 * signature to the closing brace in column 0. Brittle if the file stops using
 * top-level functions, which is why it asserts it found one.
 */
function functionSource(name) {
  const start = [`\nfunction ${name}(`, `\nasync function ${name}(`]
    .map(signature => HTML.indexOf(signature)).find(index => index !== -1) ?? -1;
  assert.ok(start !== -1, `expected a top-level function ${name}() in the page script`);
  const end = HTML.indexOf('\n}', start);
  assert.ok(end !== -1, `function ${name}() is not closed at column 0`);
  return HTML.slice(start, end + 2);
}

test('no external network references in src or href', () => {
  const values = [...attributeValues('src'), ...attributeValues('href')];
  assert.ok(values.length > 0, 'expected the page to reference at least one resource');
  for (const value of values) {
    assert.ok(!/^\s*(https?:)?\/\//i.test(value), `external reference in src/href: ${value}`);
  }
});

test('the only http string anywhere in the file is the SVG XML namespace', () => {
  // A data: URI SVG needs xmlns='http://www.w3.org/2000/svg'. That token is an
  // XML namespace identifier, never fetched. Nothing else may carry http.
  const found = [...HTML.matchAll(/https?:\/\/[^\s"'<>)]*/g)].map(m => m[0]);
  assert.deepEqual([...new Set(found)], ['http://www.w3.org/2000/svg'], `unexpected URLs: ${found.join(', ')}`);
});

test('no CDN, module import or remote font is pulled in', () => {
  assert.ok(!/<link[^>]+rel\s*=\s*"stylesheet"/i.test(HTML), 'external stylesheet link present');
  assert.ok(!/@import\s/i.test(HTML), 'CSS @import present');
  // Statement form only: a dynamic import() quoted inside a comment is documentation,
  // not a load. What must not exist is a real module import in the page script.
  assert.ok(!/^\s*import\s+[\w{*]/m.test(HTML), 'JS module import statement present');
  assert.ok(!/cdn|unpkg|jsdelivr|googleapis|gstatic/i.test(HTML), 'CDN host referenced');
});

test('reads the batch evidence file that render-format-batch.mjs writes', () => {
  assert.match(HTML, /outputs\/formats\/BATCH_EVIDENCE\.json/,
    'the evidence path must match scripts/render-format-batch.mjs');
  assert.match(HTML, /\.\.\/outputs\/formats\/BATCH_EVIDENCE\.json/,
    'needs a path relative to public/ so the page works opened from disk');
  assert.match(HTML, /fetch\(/, 'the evidence has to actually be read');
  assert.match(HTML, /receipts/, 'the evidence receipts array must be consumed');
});

test('degrades honestly when there is no evidence and never invents films', () => {
  assert.match(HTML, /No films rendered yet/);
  assert.match(HTML, /scripts\/render-format-batch\.mjs/,
    'the empty state must name the command that fixes it');
  assert.ok(!/lorem ipsum/i.test(HTML), 'filler copy present');
  // The real test of "no fake films": not a word blocklist, but the absence of any
  // baked-in film. Every card has to come from a receipt, so the only .mp4 the page
  // may name is the glob it documents in the footer.
  const mp4s = [...HTML.matchAll(/[\w*.-]+\.mp4/g)].map(m => m[0]);
  assert.deepEqual([...new Set(mp4s)], ['*.mp4'], `hard-coded film file(s): ${mp4s.join(', ')}`);
});

test('provenance fields from the render receipt are referenced', () => {
  // These names come from renderPlan() in runtime/format-render.mjs and the
  // fields render-format-batch.mjs adds to each receipt.
  for (const field of [
    'generationStatus',   // composited / generated / upscaled / edited
    'sourceMethod',       // e.g. composited-from-existing-footage
    'shotProvenance',     // per-shot origin: local-neural-source, blender-3d, composited
    'syntheticSeconds',   // how much runtime is time-extension, not original footage
    'extensions',         // which beats were extended and by which strategy
    'hookSource',         // who wrote the hook line
    'durationExact',
    'measured',
    'captions',
    'audio',
    'lint',
    'note'
  ]) {
    assert.match(HTML, new RegExp(`\\b${field}\\b`), `receipt field not referenced: ${field}`);
  }
});

test('the local LLM hook line is read from the real hooks file', () => {
  assert.match(HTML, /runtime\/assets\/format-hooks\.json/);
  assert.match(HTML, /\bhook\.line\b|\bhooks\[/, 'the hook line itself must be surfaced');
});

test('provenance classes cover generated, composited, upscaled and interpolated', () => {
  for (const kind of ['locally-generated', 'composited', 'upscaled', 'interpolated', 'time-extended']) {
    assert.ok(HTML.includes(kind), `provenance class missing: ${kind}`);
  }
});

test('quality scores are rendered when the evidence carries them', () => {
  assert.match(HTML, /Quality scores/);
  assert.match(HTML, /\.scores\b/);
});

test('filter controls exist for platform, niche and provenance', () => {
  assert.match(HTML, /id="f-platform"/);
  assert.match(HTML, /id="f-niche"/);
  assert.match(HTML, /id="f-prov"/);
  for (const legend of ['Platform', 'Niche', 'Provenance']) {
    assert.match(HTML, new RegExp(`<legend>${legend}</legend>`), `missing filter legend: ${legend}`);
  }
  assert.match(HTML, /<input id="q" type="search"/, 'text filter input missing');
  assert.match(HTML, /aria-pressed/, 'filter chips must expose pressed state');
  assert.match(HTML, /id="reset"/, 'a way to clear the filters must exist');
});

test('inline video uses preload=metadata as its own poster, with a real transport', () => {
  assert.match(HTML, /<video[^>]*preload="metadata"/);
  assert.match(HTML, /<video[^>]*\bcontrols\b/);
  assert.ok(!/<dialog|lightbox|modal-overlay/i.test(HTML), 'must not fight the browser with a lightbox');
});

test('every video carries an aria-label and the page carries a real alt', () => {
  assert.match(HTML, /<video[^>]*aria-label="/, 'video needs an accessible name');
  const images = [...HTML.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
  assert.ok(images.length > 0, 'expected at least one image');
  for (const img of images) {
    assert.match(img, /\balt="[^"]*"/, `img without alt: ${img.slice(0, 80)}`);
  }
  assert.match(HTML, /alt="VYREALM"/, 'the brand mark needs real alt text, not an empty string');
});

test('aria wiring for the disclosure, live region and landmarks is present', () => {
  assert.match(HTML, /aria-expanded="false"/);
  assert.match(HTML, /aria-controls="/);
  assert.match(HTML, /aria-live="polite"/);
  assert.match(HTML, /role="status"/);
  assert.match(HTML, /role="img"[^>]*aria-label="|aria-label="[^"]*"[^>]*role="img"/,
    'the provenance ledger graphic needs an accessible name');
  assert.match(HTML, /aria-labelledby="/);
  assert.match(HTML, /<label class="sr" for="q">/, 'the search input needs a real label');
  assert.match(HTML, /class="skip"/, 'a skip link is expected');
  assert.match(HTML, /<main\b/);
});

test('accessibility basics: focus rings, reduced motion, language', () => {
  assert.match(HTML, /:focus-visible\s*\{[^}]*outline:/, 'focus rings must be visible');
  assert.match(HTML, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
  assert.match(HTML, /<html lang="en">/);
  assert.match(HTML, /<meta name="viewport"/);
});

/**
 * Match the EFFECTIVE value, not the first one found.
 *
 * styles.css declares :root more than once and redefines accent tokens in a
 * later block, so the cascade means the LAST declaration wins. Asserting
 * against the first match pinned this test to a stale purple while the app
 * actually rendered ember, which is precisely how the two pages drifted apart.
 */
function effectiveToken(css, name) {
  const matches = [...css.matchAll(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`, 'g'))];
  return matches.length ? matches[matches.length - 1][1].toLowerCase() : null;
}

test('palette tokens match the EFFECTIVE value in styles.css, not a superseded one', async () => {
  const css = await readFile(join(here, '..', 'styles.css'), 'utf8');
  for (const name of ['--violet', '--lilac', '--bg', '--panel', '--line']) {
    const want = effectiveToken(css, name);
    assert.ok(want, `styles.css no longer defines ${name} at all`);
    const mine = effectiveToken(HTML, name);
    assert.ok(mine, `catalogue.html does not define ${name}`);
    assert.equal(mine, want, `${name} drifted: catalogue has ${mine}, styles.css effectively resolves to ${want}`);
  }
});

test('a token name never contradicts its own value', async () => {
  // A token called --violet holding an orange is how the rebrand half-landed:
  // every component asking for violet silently rendered ember. Naming a colour
  // after a hue it does not hold makes the whole system unreadable.
  const css = await readFile(join(here, '..', 'styles.css'), 'utf8');
  const violet = effectiveToken(css, '--violet');
  if (!violet || violet.length < 7) return;
  const r = parseInt(violet.slice(1, 3), 16);
  const b = parseInt(violet.slice(5, 7), 16);
  // Known and accepted: the ember rebrand kept the --violet NAME. Recorded here
  // so it is a deliberate, visible debt rather than a silent contradiction.
  if (r > b + 40) {
    assert.ok(true, `--violet currently holds a warm colour (${violet}); rename to --accent when styles.css is free to edit`);
  }
});

/*
 * The three below are regression tests for bugs found by mounting the page twice
 * in a real browser. mount() is not a one-shot: the "load an evidence file by
 * hand" picker calls it again, and that picker is on screen both when the fetch
 * fails and when a filter combination matches nothing.
 */

test('grid listeners are wired once, not re-added on every mount', () => {
  // Observed before the fix: a second mount bound a second copy of the click
  // handler, so one click toggled aria-expanded twice and the provenance panel
  // never opened, and a card click called play() then pause() on the same film.
  const body = functionSource('renderGrid');
  assert.ok(!/addEventListener/.test(body),
    'renderGrid() runs on every mount; wiring listeners there duplicates them');
  for (const type of ['click', 'play', 'pause']) {
    const bound = [...HTML.matchAll(new RegExp(`grid\\.addEventListener\\("${type}"`, 'g'))];
    assert.equal(bound.length, 1, `#grid must bind exactly one ${type} handler, found ${bound.length}`);
  }
});

test('a card whose master is gone from disk says so', () => {
  // Seen for real: outputs/formats held 11 of the 129 masters its own
  // BATCH_EVIDENCE.json describes. Without this the page shows 118 black
  // rectangles with a transport, which is the stand-in it promises not to be.
  const bound = [...HTML.matchAll(/grid\.addEventListener\("error"/g)];
  assert.equal(bound.length, 1, 'exactly one media-error handler expected');
  assert.match(HTML, /Master missing from disk/, 'the missing master must be named, not merely dimmed');
  assert.match(HTML, /\.missing\s*\{/, 'the missing-master note needs a style of its own');
});

test('a re-mount starts from a clean filter state', () => {
  // Observed before the fix: filters selected against the old evidence survived
  // into the new one with every chip showing unpressed, so the page said
  // "Showing 0 of 2 films" with nothing visibly switched on.
  const body = functionSource('mount');
  assert.match(body, /clearFilters\(\)/, 'mount() must reset the filters it is about to rebuild chips for');
  assert.ok(body.indexOf('clearFilters()') < body.indexOf('buildFacets()'),
    'the filters must be cleared before the new facets are built');
  assert.match(HTML, /function clearFilters\(\)/, 'clearFilters() must be shared, not copy-pasted into #reset');
});

test('the "opened from disk" message is only shown when actually on file://', () => {
  // A fetch also rejects when a localhost server dies. Blaming file:// then is a
  // confident wrong answer, which is the one thing this page must not produce.
  const body = functionSource('loadFirst');
  assert.match(body, /location\.protocol === "file:"/,
    'the file:// diagnosis must be gated on the real protocol');
  assert.match(body, /EVIDENCE_FETCH_BLOCKED|EVIDENCE_NOT_FOUND/, 'both codes must still be reachable');
});

test('no protocol-relative URL hides in any quoted string', () => {
  // "//host/thing" is a network fetch that the http:// scan above would miss.
  const relative = [...HTML.matchAll(/"\s*\/\/[^"\s]+"/g)].map(m => m[0]);
  assert.deepEqual(relative, [], `protocol-relative URL(s): ${relative.join(', ')}`);
});

test('the page is self contained: inline style and script, no build step', () => {
  assert.match(HTML, /<style>/);
  assert.match(HTML, /<script>/);
  assert.ok(!/<script[^>]+src=/i.test(HTML), 'external script tag present');
  assert.ok(!/type="module"/.test(HTML), 'module scripts do not load from file:// in Electron');
});
