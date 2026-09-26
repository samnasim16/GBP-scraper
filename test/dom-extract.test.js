import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { extractFeedCards, extractDetail } from '../src/dom-extract.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

function withDom(file, fn) {
    const dom = new JSDOM(fs.readFileSync(path.join(FIXTURES, file), 'utf8'),
        { url: 'https://www.google.com/maps/search/x' });
    const prev = global.document;
    global.document = dom.window.document;
    try { return fn(dom); } finally { global.document = prev; }
}

test('feed cards keep their own rating, reviews and category', () => {
    const cards = withDom('maps-feed.html', () => extractFeedCards());
    assert.equal(cards.length, 3);

    const byName = Object.fromEntries(cards.map(c => [c.name, c]));
    assert.deepEqual(
        [byName['Alpha Detailing'].rating, byName['Alpha Detailing'].reviewCount],
        [4.9, 128]);
    assert.deepEqual(
        [byName['Bravo Mobile Wash'].rating, byName['Bravo Mobile Wash'].reviewCount],
        [4.3, 27]);
    assert.deepEqual(
        [byName['Charlie Towing'].rating, byName['Charlie Towing'].reviewCount],
        [5, 8]);
});

test('a card without a Website button is not marked as having one', () => {
    const cards = withDom('maps-feed.html', () => extractFeedCards());
    const byName = Object.fromEntries(cards.map(c => [c.name, c]));
    assert.equal(byName['Alpha Detailing'].hasWebsite, true);
    assert.equal(byName['Bravo Mobile Wash'].hasWebsite, false, 'lead would be wrongly discarded');
    assert.equal(byName['Charlie Towing'].hasWebsite, false);
});

test('a status word concatenated onto the category is stripped', () => {
    const cards = withDom('maps-feed.html', () => extractFeedCards());
    const charlie = cards.find(c => c.name === 'Charlie Towing');
    assert.equal(charlie.category, 'Towing service');
});

test('permanently closed listings are flagged', () => {
    const cards = withDom('maps-feed.html', () => extractFeedCards());
    assert.equal(cards.find(c => c.name === 'Charlie Towing').closedFlag, true);
    assert.equal(cards.find(c => c.name === 'Alpha Detailing').closedFlag, false);
});

test('detail page: no-website listing reads correctly', () => {
    const d = withDom('maps-detail-nowebsite.html', () => extractDetail());
    assert.equal(d.name, 'Bravo Mobile Wash');
    assert.equal(d.websiteStatus, 'No visible Website button');
    assert.equal(d.phone, '+19785529363');
    assert.equal(d.category, 'Pressure washing service');
    assert.equal(d.address, '20 Victory Ln, Dracut, MA 01826');
    assert.equal(d.hasPhotos, true);
});

test("a neighbouring listing's rating does not leak into the business", () => {
    const d = withDom('maps-detail-nowebsite.html', () => extractDetail());
    assert.equal(d.rating, 4.3);
    assert.equal(d.reviews, 27);
    assert.notEqual(d.reviews, 999, 'picked up the "People also search for" widget');
});

test('hours come back as real hours, never the button label', () => {
    const d = withDom('maps-detail-nowebsite.html', () => extractDetail());
    assert.equal(d.hasHours, 'Yes');
    assert.notEqual(d.hoursSummary, 'Hours');
    assert.match(d.hoursSummary, /Monday, 8 AM to 6 PM/);
    assert.doesNotMatch(d.hoursSummary, /Hide open hours/);
});

test('hours fall back to the weekly table', () => {
    const d = withDom('maps-detail-website.html', () => extractDetail());
    assert.equal(d.hoursSummary, 'Monday 8 AM–5 PM; Sunday Closed');
});

test('detail page: an authority link means the business has a website', () => {
    const d = withDom('maps-detail-website.html', () => extractDetail());
    assert.equal(d.websiteStatus, 'Website visible');
    assert.equal(d.websiteUrl, 'https://alphadetailing.example.com/');
});

test('a Facebook link is never mistaken for a booking link', () => {
    const d = withDom('maps-detail-website.html', () => extractDetail());
    assert.equal(d.bookingLink, 'https://squareup.com/appointments/book/alpha');
    assert.deepEqual(d.socialUrls, ['https://www.facebook.com/AlphaDetailingMA']);
});

test('editorial summary, price and email are read from the detail page', () => {
    const d = withDom('maps-detail-website.html', () => extractDetail());
    assert.match(d.description, /^Full-service auto detailing studio/);
    assert.equal(d.priceLevel, 'Moderate');
    assert.equal(d.email, 'hello@alphadetailing.example.com');
});

test('in-page functions survive serialisation into the browser', () => {
    // puppeteer sends these across as source text, so they must not reference
    // anything from module scope. Round-tripping through Function() here fails
    // loudly at test time instead of silently on a paid run.
    for (const fn of [extractFeedCards, extractDetail]) {
        const src = fn.toString();
        assert.doesNotMatch(src, /\bimport\b|\brequire\(/, `${fn.name} pulls in a module`);
        const rebuilt = new Function(`return (${src})`)();
        const dom = new JSDOM(fs.readFileSync(path.join(FIXTURES, 'maps-detail-nowebsite.html'), 'utf8'),
            { url: 'https://www.google.com/maps/place/x' });
        const prev = global.document;
        global.document = dom.window.document;
        try {
            assert.doesNotThrow(() => rebuilt(), `${fn.name} failed once detached from module scope`);
        } finally {
            global.document = prev;
        }
    }
});

test('a phone number in a card is never read as a review count', () => {
    // A business with no reviews shows its phone instead of a rating, and
    // "(978) 702-3418" contains "(978)". A live run put the area code in the
    // review column of 104 leads and scored every one of them on it.
    const cards = withDom('maps-feed-noreviews.html', () => extractFeedCards());
    assert.equal(cards.length, 1);
    assert.equal(cards[0].name, 'At Ease Mobile Wash');
    assert.equal(cards[0].rating, null);
    assert.equal(cards[0].reviewCount, 0, 'read the phone area code as reviews');
});

test('no rating means no review count, in the feed and on the detail page', () => {
    // Google never shows a review count without a rating, so a count without
    // one came from something else. Under-report rather than invent evidence.
    const cards = withDom('maps-feed-noreviews.html', () => extractFeedCards());
    assert.equal(cards[0].reviewCount, 0);

    // The rated fixtures must be unaffected.
    const rated = withDom('maps-feed.html', () => extractFeedCards());
    assert.deepEqual(rated.map(c => c.reviewCount), [128, 27, 8]);
    const detail = withDom('maps-detail-nowebsite.html', () => extractDetail());
    assert.equal(detail.rating, 4.3);
    assert.equal(detail.reviews, 27);
});

test("Google's holiday caveat is stripped from hours", () => {
    const d = withDom('maps-detail-nowebsite.html', () => extractDetail());
    assert.doesNotMatch(d.hoursSummary, /Hours might differ/i);
});

test('German phone numbers are normalised to +49', () => {
    const html = (tel) => `<div role="main"><h1 class="DUwDvf">Judaica Haus</h1>
        <button data-item-id="phone:tel:${tel}"></button></div>`;
    const read = (tel) => {
        const dom = new JSDOM(html(tel), { url: 'https://www.google.com/maps/place/x' });
        const prev = global.document;
        global.document = dom.window.document;
        try { return extractDetail().phone; } finally { global.document = prev; }
    };
    assert.equal(read('+49 30 1234567'), '+49301234567');
    assert.equal(read('030 1234567'), '+49301234567');
    assert.equal(read('0049 89 987654'), '+4989987654');
    assert.equal(read('+43 1 5551234'), '+4315551234', 'an Austrian number is not rewritten');
});
