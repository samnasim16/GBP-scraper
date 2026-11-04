import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveCountry, resolveLocations, buildQueryMatrix } from '../src/config.js';
import { EUROPE_MARKETS, marketOfAddress } from '../src/europe.js';
import { JSDOM } from 'jsdom';
import { cityFromAddress, pickCity, scrapeQuery } from '../src/maps.js';
import { extractFeedCards, extractDetail } from '../src/dom-extract.js';
import { scoreRelevance, isTarget } from '../src/relevance.js';
import { createSaver } from '../src/output.js';
import { loadTemplate } from '../src/email-template.js';

const EU = resolveCountry({ country: 'Europe', campaign: 'sushi' });
const tierOf = (business_name, category) => scoreRelevance({ business_name, category, country: 'FR', campaign: 'sushi' }).tier;

test('Europe: every country, sushi places only, its own folder and list', () => {
    assert.equal(EU.code, 'EU');
    assert.equal(EU.outputDir, 'output-eu-sushi');
    assert.equal(EU.script, 'sushi:europe');
    assert.deepEqual(EU.includeTiers, ['Sushi place']);
    assert.deepEqual(EU.list.columns.slice(0, 5), ['business_name', 'city', 'country_name', 'address', 'rating']);
    // Every EU member and the rest of Europe, each with cities to search.
    for (const code of ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT',
        'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'UK', 'NO', 'CH', 'IS', 'RS', 'UA']) {
        assert.ok(EUROPE_MARKETS[code], code);
        assert.ok(EU.regions[code].length > 0, code);
    }
    for (const code of Object.keys(EU.regions)) assert.ok(EUROPE_MARKETS[code], `${code} has a market`);
    // Europe has no Judaica profile.
    assert.throws(() => resolveCountry({ country: 'EU' }), /campaign only/);

    const locs = resolveLocations({ country: 'EU', campaign: 'sushi' }, () => {});
    assert.ok(locs.some(l => l.city === 'Soho, London' && l.state === 'UK'));
    assert.ok(locs.some(l => l.city === 'Reykjavík' && l.state === 'IS'));
    const q = buildQueryMatrix(locs, EU.categories, EU.highYield);
    // Every place is searched once before the second term.
    assert.ok(q.slice(0, locs.length).every(x => x.category === 'Sushi restaurant'));
    // Only some countries: "states".
    assert.deepEqual([...new Set(resolveLocations({ country: 'EU', campaign: 'sushi', states: ['pt', 'IE'] }, () => {}).map(l => l.state))], ['PT', 'IE']);
});

test('Europe: the town comes from the address, in every postcode style', () => {
    const cases = [
        ['Rua Augusta 10, 1100-053 Lisboa', 'PT', 'Lisboa'],
        ['ul. Nowy Świat 5, 00-950 Warszawa', 'PL', 'Warszawa'],
        ['Damrak 1, 1012 LG Amsterdam', 'NL', 'Amsterdam'],
        ['Drottninggatan 1, 111 51 Stockholm', 'SE', 'Stockholm'],
        ['Via Roma 1, 20121 Milano MI', 'IT', 'Milano'],
        ['Václavské nám. 1, 110 00 Praha 1', 'CZ', 'Praha'],
        ['Rue X 1, L-1724 Luxembourg', 'LU', 'Luxembourg'],
        ['Ermou 1, Athina 105 63', 'GR', 'Athina'],
        ['Váci u. 1, Budapest, 1052', 'HU', 'Budapest'],
        ['23 Dawson St, Dublin 2, D02 X285', 'IE', 'Dublin'],
        ['Tverskaya St, 1, Moskva, 125009', 'RU', 'Moskva'],
        ['5 Soho Sq, London W1D 3QA', 'UK', 'London'],
        // Germany, Belgium and France read as before.
        ['Fasanenstraße 79, 10623 Berlin', 'DE', 'Berlin'],
        ['10 Rue des Rosiers, 75004 Paris', 'FR', 'Paris'],
    ];
    for (const [address, code, town] of cases) assert.equal(cityFromAddress(address, code), town, address);
    // A house number is not a postcode.
    assert.equal(cityFromAddress('23 Dawson St', 'IE'), '');
    // Luxembourg names the quarter before the city.
    assert.equal(pickCity('28 Rue du Curé, 1368 Ville-Haute Luxembourg', 'Luxembourg', { ...EU, code: 'LU' }), 'Luxembourg');
});

test('Europe: national phone numbers get the right country code, with or without a trunk 0', () => {
    const read = (tel, market) => {
        const dom = new JSDOM(`<div role="main"><h1 class="DUwDvf">X</h1><button data-item-id="phone:tel:${tel}"></button></div>`, { url: 'https://www.google.com/maps/place/x' });
        const prev = global.document;
        global.document = dom.window.document;
        const m = EUROPE_MARKETS[market];
        try { return extractDetail(m.phoneCode, m.trunks || ['0']).phone; } finally { global.document = prev; }
    };
    // A sushi bar in Luxembourg came back as +20221872 (an Egyptian prefix).
    assert.equal(read('20221872', 'LU'), '+35220221872');
    assert.equal(read('02 1234 5678', 'IT'), '+390212345678', 'Italy keeps its 0');
    assert.equal(read('912 345 678', 'ES'), '+34912345678');
    assert.equal(read('21 123 4567', 'PT'), '+351211234567');
    assert.equal(read('030 123456', 'DE'), '+4930123456');
    assert.equal(read('020 7946 0000', 'UK'), '+442079460000');
    assert.equal(read('8 495 123-45-67', 'RU'), '+74951234567');
    assert.equal(read('+352 20 22 18 72', 'LU'), '+35220221872');
});

test('Europe: the country comes from the address abroad, and results outside Europe are dropped', () => {
    assert.equal(marketOfAddress('Hauptstraße 1, 77694 Kehl, Germany'), 'DE');
    assert.equal(marketOfAddress('İstiklal Cd. 1, 34433 Beyoğlu/İstanbul, Türkiye'), 'TR');
    assert.equal(marketOfAddress('Rua Augusta 10, 1100-053 Lisboa'), '');
    for (const a of ['100 Main St, Paris, TX 75460, United States', 'Av. Bolívar, Valencia 2001, Carabobo, Venezuela', '1 Sushi Rd, Toronto, ON M5V 2T6, Canada']) {
        assert.ok(EU.foreign.test(a), a);
    }
    for (const a of ['Rua Augusta 10, 1100-053 Lisboa', 'Via Roma 1, 20121 Milano MI', 'Hauptstraße 1, 77694 Kehl, Germany']) {
        assert.ok(!EU.foreign.test(a), a);
    }
});

test('Europe: sushi places only; sushi in Cyrillic, Greek and Japanese counts', () => {
    assert.equal(tierOf('Sushi Shop', 'Sushi restaurant'), 'Sushi place');
    assert.equal(tierOf('Суши Мастер', 'Restaurant'), 'Sushi place');
    assert.equal(tierOf('Якитория', 'Sushi takeaway'), 'Sushi place');
    assert.equal(tierOf('Σούσι Μπαρ', 'Restaurant'), 'Sushi place');
    assert.equal(tierOf('寿司 Kyo', 'Japanese restaurant'), 'Sushi place');
    // A Japanese restaurant with no sushi seen is listed, not a target.
    assert.equal(tierOf('Udon House', 'Japanese restaurant'), 'Japanese / Asian restaurant');
    assert.ok(!isTarget({ relevance_tier: 'Japanese / Asian restaurant' }, EU.includeTiers));
    assert.equal(tierOf('Lidl', 'Supermarket'), 'Not a restaurant');
});

test('Europe: each search runs as its own country — Google region, phone code, Country column', async () => {
    const urls = [];
    let current = '';
    let fronted = 0;
    const cards = [
        { name: 'Sushi Lisboa', href: 'https://www.google.com/maps/place/a/data=!1s0x1:0xa', category: 'Sushi restaurant', rating: 4.6, reviewCount: 300, closedFlag: false },
        { name: 'Sushi Kehl', href: 'https://www.google.com/maps/place/b/data=!1s0x1:0xb', category: 'Sushi restaurant', rating: 4.1, reviewCount: 50, closedFlag: false },
        { name: 'Pingo Doce', href: 'https://www.google.com/maps/place/c/data=!1s0x1:0xc', category: 'Supermarket', rating: 4, reviewCount: 900, closedFlag: false },
    ];
    const details = {
        a: { name: 'Sushi Lisboa', address: 'Rua Augusta 10, 1100-053 Lisboa', category: 'Sushi restaurant', phone: '+351211234567', rating: 4.6, reviews: 300 },
        b: { name: 'Sushi Kehl', address: 'Hauptstraße 1, 77694 Kehl, Germany', category: 'Sushi restaurant', phone: '+497851123', rating: 4.1, reviews: 50 },
    };
    const page = {
        url: () => current || 'https://www.google.com/maps/search/x',
        goto: async (u) => { current = u; urls.push(u); },
        $: async (sel) => (sel === 'div[role="feed"]' || sel === 'h1.DUwDvf' ? {} : null),
        $$eval: async () => cards.length,
        waitForSelector: async () => {},
        bringToFront: async () => { fronted++; },
        evaluate: async (fn, arg) => {
            if (fn === extractFeedCards) return cards;
            if (fn === extractDetail) {
                assert.equal(arg, '351', 'the Portuguese phone code');
                return details[current.match(/place\/(\w)/)[1]];
            }
            return null;
        },
    };
    const allLeads = [];
    await scrapeQuery(page, { text: 'Sushi restaurant Lisbon', city: 'Lisbon', state: 'PT' }, { seen: new Set(), allLeads, log: () => {} },
        { maxResultsPerQuery: 60, maxScrolls: 0, minReviews: 0, maxLeads: 100, delayBetweenListings: 0, keepNonProfits: false, country: EU });
    assert.match(urls[0], /\?hl=en&gl=pt$/);
    // A background tab doesn't load more results; the Maps tab comes to the front first.
    assert.equal(fronted, 1);
    assert.ok(urls.slice(1).every(u => /gl=pt/.test(u)));
    // The supermarket never opens.
    assert.deepEqual(allLeads.map(l => l.business_name), ['Sushi Lisboa', 'Sushi Kehl']);
    const [lisboa, kehl] = allLeads;
    assert.equal(lisboa.city, 'Lisboa');
    assert.equal(lisboa.country_name, 'Portugal');
    assert.equal(lisboa.country, 'PT');
    assert.equal(lisboa.rating, 4.6);
    assert.equal(lisboa.relevance_tier, 'Sushi place');
    assert.equal(kehl.city, 'Kehl');
    assert.equal(kehl.country_name, 'Germany');
});

test('Europe: the saver writes the plain list with readable headers, and a list sheet', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eu-sushi-'));
    const leads = [
        { business_name: 'Sushi Lisboa', city: 'Lisboa', country_name: 'Portugal', address: 'Rua Augusta 10, 1100-053 Lisboa', rating: 4.6, review_count: 300,
            relevance_tier: 'Sushi place', relevance_score: 80, maps_url: 'https://www.google.com/maps/place/a', campaign: 'sushi', country: 'PT' },
        { business_name: 'Udon House', city: 'Porto', country_name: 'Portugal', address: 'Rua X, 4000-001 Porto', rating: 4.2,
            relevance_tier: 'Japanese / Asian restaurant', relevance_score: 25, maps_url: 'https://www.google.com/maps/place/b', campaign: 'sushi', country: 'PT' },
    ];
    await createSaver(dir, { template: loadTemplate(EU.emailTemplate), includeTiers: EU.includeTiers, workbook: EU.workbook, list: EU.list, log: () => {} })(leads);
    const csv = fs.readFileSync(path.join(dir, 'sushi-europe-list.csv'), 'utf8').replace(/^﻿/, '').split('\n');
    assert.equal(csv[0], 'Business Name,City,Country,Address,Rating,Reviews,Phone,Website,Maps URL');
    assert.equal(csv.length, 2, 'sushi places only');
    assert.match(csv[1], /^Sushi Lisboa,Lisboa,Portugal,"?Rua Augusta 10, 1100-053 Lisboa"?,4\.6,300,/);
    assert.ok(fs.existsSync(path.join(dir, 'sushi-europe.xlsx')));
    const full = fs.readFileSync(path.join(dir, 'leads.csv'), 'utf8');
    assert.match(full.split('\n')[0], /country_name/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('Germany sushi: exactly the given searches, cities stay cities, and the PDF email', async () => {
    const input = JSON.parse(fs.readFileSync(new URL('../input.germany-sushi.json', import.meta.url), 'utf8'));
    const DE = resolveCountry(input);
    const q = buildQueryMatrix(resolveLocations(input, () => {}), input.searchCategories, DE.highYield);
    // "Sushi Düsseldorf" was listed twice; it runs once.
    assert.deepEqual(q.map(x => x.text), ['Sushi Berlin', 'Sushi Nürnberg', 'Sushi Düsseldorf', 'Sushi München', 'Sushi Hamburg',
        'Sushi Köln', 'Sushi Frankfurt', 'Sushi Stuttgart', 'Sushi Leipzig', 'Sushi Dortmund']);
    assert.ok(q.every(x => x.state === 'DE'), 'every search runs as Germany');
    assert.deepEqual(input.includeTiers, ['Sushi place']);
    // Maps names the district after a German postcode; the searched city stays.
    const de = { ...EU, code: 'DE', districtTowns: true };
    assert.equal(pickCity('Venloer Str. 1, 50823 Ehrenfeld', 'Köln', de), 'Köln');
    assert.equal(pickCity('Königsallee 1, 40212 Düsseldorf', 'Düsseldorf', de), 'Düsseldorf');

    const { renderEmail } = await import('../src/email-template.js');
    const { loadWhatsAppTemplate } = await import('../src/whatsapp.js');
    const e = renderEmail({ business_name: 'Sushi Ninja | Best Sushi in Köln' }, loadTemplate(EU.emailTemplate));
    assert.equal(e.subject, "Quick question about Sushi Ninja's sushi plates");
    assert.match(e.body, /^Hi there,\n/);
    assert.match(e.body, /might suit Sushi Ninja\./);
    assert.match(e.body, /WhatsApp: \+972 53-854-8320/);
    assert.match(e.body, /Reply "no thanks"/);
    assert.doesNotMatch(e.subject + e.body, /\{\{|\[Your Name\]/);
    // A first name written in by hand is used.
    assert.match(renderEmail({ business_name: 'X', first_name: 'Anna' }, loadTemplate(EU.emailTemplate)).body, /^Hi Anna,/);
    assert.match(loadWhatsAppTemplate(EU.whatsappTemplate), /\+?972|sushi plates/);
});

test('Germany sushi: a menu heading is not the owner', async () => {
    const { extractContact } = await import('../src/contacts.js');
    // Live run, Sakura Leipzig: "Speisekarte Vorspeiesen Sushi Spezialitäten" came back as the contact.
    assert.equal(extractContact('Inhaber: Speisekarte Vorspeiesen Sushi Spezialitäten').name, '');
    assert.equal(extractContact('Inhaberin: Thi Bich Thuy Nguyen').name, 'Thi Bich Thuy Nguyen');
});

test('full Germany sushi run: company forms, footer words and streets are cut from owner names', async () => {
    const { extractContact } = await import('../src/contacts.js');
    const cases = [
        ['Inhaber: Andreas Karlsson GmbH', 'Andreas Karlsson'],
        ['Geschäftsführer: Thanh Pham Schließen Datenschutzerklärung', 'Thanh Pham'],
        ['Inhaber: Jörg Better Steuernr.: 123', 'Jörg Better'],
        ['Inhaber: David Nguyen Lieferzeiten Lieferzeit', 'David Nguyen'],
        ['Inhaber: Kien Cuong Dang Marienburger Str. 5', 'Kien Cuong Dang'],
        ['Inhaber: Philipp Strähle Eingetragen im Handelsregister', 'Philipp Strähle'],
        ['Vertreten durch: Mood Dining Concept GmbH', ''],
        ['Inhaberin: Öz GbR', ''],
    ];
    for (const [text, name] of cases) assert.equal(extractContact(text).name, name, text);
});

test('full Germany sushi run: a street cut at its ß and disclaimer text are not part of a name', async () => {
    const { extractContact } = await import('../src/contacts.js');
    assert.equal(extractContact('Inhaber: Apichat Srisang Derendorferstra').name, 'Apichat Srisang');
    assert.equal(extractContact('Inhaber: Haifan Xiang Disclaimer Trotz sorgfältiger Kontrolle').name, 'Haifan Xiang');
    assert.equal(extractContact('Inhaberin: Petra Schmidt').name, 'Petra Schmidt');
});
