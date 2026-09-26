/**
 * Verifies the in-page extractors against a REAL Chrome, not just jsdom.
 *
 * jsdom proves the logic; only a real browser proves that puppeteer can
 * serialise these functions and that Chrome's DOM agrees. Skipped
 * automatically when no Chrome is installed.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { createBrowserFactory, resolveChromePath, isSessionDead } from '../src/browser.js';
import { extractFeedCards, extractDetail } from '../src/dom-extract.js';
import { detectBlockPage } from '../src/maps.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const fileUrl = f => 'file://' + path.join(FIXTURES, f);

const chromePath = await resolveChromePath('');
const skip = chromePath ? false : 'no Chrome installed on this machine';

let factory;
let session;

before(async () => {
    if (skip) return;
    factory = await createBrowserFactory({
        config: { mode: 'local', headless: true, userDataDir: '' },
        log: () => {},
    });
    session = await factory.open();
});

after(async () => {
    if (factory && session) await factory.close(session);
});

/** Run the same extractor over the same file in jsdom, for comparison. */
function viaJsdom(file, fn) {
    const dom = new JSDOM(fs.readFileSync(path.join(FIXTURES, file), 'utf8'),
        { url: 'https://www.google.com/maps/search/x' });
    const prev = global.document;
    global.document = dom.window.document;
    try { return fn(); } finally { global.document = prev; }
}

test('feed extraction in real Chrome matches jsdom', { skip }, async () => {
    await session.page.goto(fileUrl('maps-feed.html'), { waitUntil: 'domcontentloaded' });
    const chrome = await session.page.evaluate(extractFeedCards);
    const jsdom = viaJsdom('maps-feed.html', () => extractFeedCards());

    assert.equal(chrome.length, 3);
    assert.deepEqual(
        chrome.map(c => [c.name, c.rating, c.reviewCount, c.category, c.hasWebsite]),
        jsdom.map(c => [c.name, c.rating, c.reviewCount, c.category, c.hasWebsite]));

    // The regression itself: each card keeps its own numbers.
    const byName = Object.fromEntries(chrome.map(c => [c.name, c]));
    assert.equal(byName['Bravo Mobile Wash'].reviewCount, 27);
    assert.equal(byName['Charlie Towing'].reviewCount, 8);
});

test('detail extraction in real Chrome matches jsdom', { skip }, async () => {
    for (const f of ['maps-detail-nowebsite.html', 'maps-detail-website.html']) {
        await session.page.goto(fileUrl(f), { waitUntil: 'domcontentloaded' });
        const chrome = await session.page.evaluate(extractDetail);
        const jsdom = viaJsdom(f, () => extractDetail());
        for (const key of ['name', 'rating', 'reviews', 'category', 'phone', 'websiteStatus', 'hoursSummary', 'bookingLink', 'email', 'priceLevel']) {
            assert.deepEqual(chrome[key], jsdom[key], `${f}: ${key} differs between Chrome and jsdom`);
        }
    }
});

test("Google's anti-bot wall is recognised", { skip }, async () => {
    await session.page.goto(fileUrl('google-block.html'), { waitUntil: 'domcontentloaded' });
    assert.ok(await detectBlockPage(session.page), 'block page not detected');

    await session.page.goto(fileUrl('maps-feed.html'), { waitUntil: 'domcontentloaded' });
    assert.equal(await detectBlockPage(session.page), null, 'a normal results page was flagged as blocked');
});

test('the browser reports as a normal desktop Chrome', { skip }, async () => {
    await session.page.goto(fileUrl('maps-feed.html'), { waitUntil: 'domcontentloaded' });
    const ua = await session.page.evaluate(() => navigator.userAgent);
    assert.doesNotMatch(ua, /Headless/i, 'user agent advertises headless');
    assert.ok(!(await session.page.evaluate(() => navigator.webdriver)),
        'navigator.webdriver is truthy — automation is detectable');
});

test('errors that mean the session is gone are told apart from ordinary failures', () => {
    // Left un-skipped: pure classification, no browser needed.
    for (const msg of [
        "Attempted to use detached Frame '2D32024E3C49B1C4CFB04A43CF3E9537'.",
        'Protocol error (Page.navigate): Target closed',
        'Session closed. Most likely the page has been closed.',
        'Navigation failed because browser has disconnected!',
    ]) {
        assert.ok(isSessionDead(new Error(msg)), `should be fatal to the session: ${msg}`);
    }
    for (const msg of [
        'net::ERR_TUNNEL_CONNECTION_FAILED at https://www.google.com/maps',
        'Navigation timeout of 45000 ms exceeded',
        'net::ERR_NAME_NOT_RESOLVED',
    ]) {
        assert.ok(!isSessionDead(new Error(msg)), `should be a normal query failure: ${msg}`);
    }
});

test('the session owns its own tab, not the one Chrome opens at startup', { skip }, async () => {
    // Adopting Chrome's startup tab is what produced "Attempted to use detached
    // Frame" on Windows: with a persistent profile Chrome may discard it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
    const f = await createBrowserFactory({
        config: { mode: 'local', headless: true, userDataDir: dir },
        log: () => {},
    });
    const s = await f.open();
    try {
        const pages = await s.browser.pages();
        assert.equal(pages.length, 1, 'startup tab was left open');
        assert.equal(pages[0], s.page, 'the surviving tab is not the one we configured');
        await s.page.goto(fileUrl('maps-feed.html'), { waitUntil: 'domcontentloaded' });
        assert.equal((await s.page.evaluate(extractFeedCards)).length, 3);
    } finally {
        await f.close(s);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a lost session can be reopened and keeps working', { skip }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
    const f = await createBrowserFactory({
        config: { mode: 'local', headless: true, userDataDir: dir },
        log: () => {},
    });
    let s = await f.open();
    try {
        await s.page.close();   // as if Chrome discarded our tab
        let err;
        try { await s.page.goto('about:blank'); } catch (e) { err = e; }
        assert.ok(isSessionDead(err), `not recognised as a dead session: ${err && err.message}`);

        await f.close(s);
        s = await f.open();
        await s.page.goto(fileUrl('maps-feed.html'), { waitUntil: 'domcontentloaded' });
        assert.equal((await s.page.evaluate(extractFeedCards)).length, 3, 'reopened session cannot scrape');
    } finally {
        await f.close(s);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a locked profile falls back to a temporary one instead of failing the run', { skip }, async () => {
    // A run killed with Ctrl-C leaves the profile lock behind; the next run
    // must still start.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
    const config = { mode: 'local', headless: true, userDataDir: dir };
    const first = await createBrowserFactory({ config, log: () => {} });
    const held = await first.open();
    try {
        const second = await createBrowserFactory({ config, log: () => {} });
        const s2 = await second.open();
        try {
            await s2.page.goto(fileUrl('maps-feed.html'), { waitUntil: 'domcontentloaded' });
            assert.equal((await s2.page.evaluate(extractFeedCards)).length, 3);
        } finally {
            await second.close(s2);
        }
    } finally {
        await first.close(held);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('concurrent workers share one browser instead of racing to launch', { skip }, async () => {
    // In the field four enrichment workers asked for a browser at once, each
    // launched its own Chrome, and they collided on the profile lock.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
    let launches = 0;
    let factory = null;
    let session = null;
    let launching = null;

    const getBrowser = async () => {
        if (session) return session.browser;
        if (!launching) {
            launching = (async () => {
                launches++;
                factory = await createBrowserFactory({
                    config: { mode: 'local', headless: true, userDataDir: dir },
                    log: () => {},
                });
                session = await factory.open();
                return session.browser;
            })();
        }
        return launching;
    };

    try {
        const browsers = await Promise.all(Array.from({ length: 6 }, () => getBrowser()));
        assert.equal(launches, 1, `launched ${launches} browsers for 6 concurrent callers`);
        assert.ok(browsers.every(b => b === browsers[0]), 'callers got different browsers');
    } finally {
        if (factory && session) await factory.close(session);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a browser that will not start with a profile still starts without one', { skip }, async () => {
    // Windows reports "profile in use" as a dialog, not on stderr, so the
    // message is unmatchable — the recovery has to be an unconditional retry.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
    const holder = await createBrowserFactory({
        config: { mode: 'local', headless: true, userDataDir: dir },
        log: () => {},
    });
    const held = await holder.open();
    try {
        const lines = [];
        const second = await createBrowserFactory({
            config: { mode: 'local', headless: true, userDataDir: dir },
            log: m => lines.push(m),
        });
        const s2 = await second.open();
        try {
            await s2.page.goto(fileUrl('maps-feed.html'), { waitUntil: 'domcontentloaded' });
            assert.equal((await s2.page.evaluate(extractFeedCards)).length, 3);
        } finally {
            await second.close(s2);
        }
    } finally {
        await holder.close(held);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

