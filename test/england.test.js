import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { resolveCountry, resolveLocations, buildQueryMatrix, ENGLAND_CITIES } from '../src/config.js';
import { mapsSearchUrl } from '../src/maps.js';
import { extractDetail } from '../src/dom-extract.js';
import { ContactEnricher, greetingFor, extractContact, rankEmails, registrableDomain, guessContactUrls } from '../src/contacts.js';
import { createHttpClient } from '../src/http.js';
import { scoreRelevance, isSellable, isTarget } from '../src/relevance.js';

const SHOP = path.join(import.meta.dirname, 'fixtures', 'shop-uk');

test('England is its own market: English terms, English cities, its own output folder', () => {
    for (const name of ['UK', 'uk', 'GB', 'England']) assert.equal(resolveCountry({ country: name }).code, 'UK');
    assert.equal(resolveCountry({}).code, 'DE', 'Germany stays the default');
    assert.throws(() => resolveCountry({ country: 'Narnia' }));

    const uk = resolveCountry({ country: 'UK' });
    assert.equal(uk.outputDir, 'output-uk');
    const locs = resolveLocations({ country: 'UK' }, () => {});
    assert.ok(locs.some(l => l.city === 'Golders Green, London'));
    assert.ok(locs.some(l => l.city === 'Prestwich, Manchester'));
    assert.ok(locs.some(l => l.city === 'Gateshead'));
    assert.ok(!locs.some(l => l.city === 'Berlin'));
    assert.deepEqual(resolveLocations({ country: 'UK', states: ['ne'], districts: false }, () => {}).map(l => l.city), ENGLAND_CITIES.NE);

    const q = buildQueryMatrix(locs, uk.categories, uk.highYield);
    assert.equal(q[0].text, 'Judaica London');
    assert.equal(mapsSearchUrl('Judaica London', uk.gl), 'https://www.google.com/maps/search/Judaica%20London?hl=en&gl=uk');
});

test('UK numbers become +44, and an Irish shop is outside England', () => {
    const read = (tel) => {
        const dom = new JSDOM(`<div role="main"><h1 class="DUwDvf">X</h1><button data-item-id="phone:tel:${tel}"></button></div>`,
            { url: 'https://www.google.com/maps/place/x' });
        const prev = global.document;
        global.document = dom.window.document;
        try { return extractDetail('44').phone; } finally { global.document = prev; }
    };
    assert.equal(read('020 8455 0000'), '+442084550000');
    assert.equal(read('0161 773 0000'), '+441617730000');
    assert.equal(read('+49 30 1234567'), '+49301234567', 'a German number is not rewritten');

    const uk = resolveCountry({ country: 'UK' });
    assert.ok(uk.foreign.test('12 Grafton Street, Dublin 2, Ireland'));
    assert.ok(!uk.foreign.test('100 Golders Green Road, London NW11 8HB, United Kingdom'));
    assert.ok(!uk.foreign.test('5 Bury Old Road, Prestwich, Manchester M25 0FG'));
});

test('English honorifics: Mr. is never read as Ms.', () => {
    // "Mrs?" once matched "Mr", so "Mr. David Levy" would have been "Dear Ms. Levy".
    assert.equal(greetingFor({ contact_name: 'Mr David Levy' }), 'Dear Mr. Levy');
    assert.equal(greetingFor({ contact_name: 'Mr. David Levy' }), 'Dear Mr. Levy');
    assert.equal(greetingFor({ contact_name: 'Mrs Rachel Cohen' }), 'Dear Ms. Cohen');
    assert.equal(greetingFor({ contact_name: 'Miss Hannah Gold' }), 'Dear Ms. Gold');
    assert.deepEqual(extractContact('Director: Mrs Rachel Cohen'), { name: 'Mrs Rachel Cohen', role: '' });
    assert.equal(extractContact('Founder: Daniel Stern Ltd registered in England').name, 'Daniel Stern');
});

test('UK domains and inboxes rank correctly', () => {
    assert.equal(registrableDomain('shop.goldersgreenjudaica.co.uk'), 'goldersgreenjudaica.co.uk');
    assert.equal(registrableDomain('www.example.ltd.uk'), 'example.ltd.uk');
    assert.equal(rankEmails(['studio@webdesignlondon.co.uk', 'owner@btinternet.com', 'enquiries@goldersgreenjudaica.co.uk'],
        'https://www.goldersgreenjudaica.co.uk/', 'Golders Green Judaica')[0], 'enquiries@goldersgreenjudaica.co.uk');
    assert.deepEqual(guessContactUrls('https://x.co.uk/a', ['/contact', '/contact-us']), ['https://x.co.uk/contact', 'https://x.co.uk/contact-us']);
});

test('UK relevance: synagogues, charities and councils out; Judaica and kosher shops in', () => {
    for (const lead of [
        { business_name: 'Finchley United Synagogue', category: 'Synagogue' },
        { business_name: 'Chabad Lubavitch of Manchester', category: 'Religious organisation' },
        { business_name: 'Jewish Care', category: 'Charity' },
        { business_name: 'Golders Green Hebrew Congregation', category: '' },
        { business_name: 'JW3', category: 'Community center' },
        { business_name: 'Jewish Museum London', category: 'Museum' },
        { business_name: 'Barnet Libraries', category: 'Art Gallery', website: 'https://www.barnet.gov.uk/libraries' },
    ]) assert.equal(isSellable(lead).ok, false, lead.business_name);

    assert.equal(scoreRelevance({ business_name: 'Golders Green Judaica', category: 'Gift shop' }).tier, 'Judaica seller');
    assert.equal(scoreRelevance({ business_name: 'Menorah Gifts', category: 'Gift shop' }).tier, 'Judaica seller');
    assert.equal(scoreRelevance({ business_name: 'Kosher Kingdom', category: 'Kosher grocery store' }).tier, 'Jewish / Israeli retail');
    assert.equal(scoreRelevance({ business_name: 'Brownstein Books', category: 'Book shop' }, 'Hanukkiah and kiddush cups, Jewish books').tier, 'Judaica seller');
    assert.ok(!isTarget(scoreRelevance({ business_name: 'Kosher Restaurant', category: 'Kosher restaurant' })));
    assert.ok(!isTarget(scoreRelevance({ business_name: 'Levy & Co Solicitors', category: 'Solicitor' }, 'Jewish Israel')));
});

test('end to end: an English shop site gives its contact-page email and director', async (t) => {
    const server = http.createServer((req, res) => {
        const file = { '/': 'index.html', '/contact-us': 'contact-us.html' }[req.url];
        if (!file) { res.writeHead(404); res.end('nope'); return; }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(path.join(SHOP, file), 'utf8'));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    t.after(() => server.close());
    const uk = resolveCountry({ country: 'UK' });
    const enricher = new ContactEnricher({
        http: createHttpClient({ transport: 'local' }),
        config: { delayMs: 0, acceptLanguage: uk.acceptLanguage, keyPage: uk.contactKeyPage, guessPaths: uk.contactPaths },
        log: () => {},
    });
    const lead = { business_name: 'Golders Green Judaica', website: `http://127.0.0.1:${server.address().port}/` };
    await enricher.enqueue(lead);
    assert.equal(lead.email, 'enquiries@goldersgreenjudaica.co.uk');
    assert.equal(lead.contact_name, 'Mrs Rachel Cohen');
    assert.equal(greetingFor(lead), 'Dear Ms. Cohen');
    assert.equal(scoreRelevance({ ...lead, category: 'Gift shop' }, lead._siteText).tier, 'Judaica seller');
});

test('smoke run: a website theme\'s demo inboxes are not the shop\'s', async () => {
    // Torah Treasures (London) came back as contact@martfury.com.
    const { extractEmails } = await import('../src/contacts.js');
    const html = '<p>contact@martfury.com career@martfury.com customercare@martfury.com media@martfury.com</p>'
        + '<p>info@company.com hello@demo-shop.com sales@yourstore.com</p>';
    assert.deepEqual(extractEmails(html), []);
    assert.deepEqual(extractEmails('<a href="mailto:shop@torahtreasures.co.uk">x</a> royaljudaica.co.uk@gmail.com'),
        ['shop@torahtreasures.co.uk', 'royaljudaica.co.uk@gmail.com']);
});
