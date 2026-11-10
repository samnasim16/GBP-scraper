import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { resolveCountry, resolveLocations, buildQueryMatrix, resolveOutputDir } from '../src/config.js';
import { WORLD_MARKETS } from '../src/world.js';
import { EUROPE_MARKETS, marketOfAddress } from '../src/europe.js';
import { scoreRelevance, isSellable, isPublicBody } from '../src/relevance.js';
import { SPECIALTIES, SUBMISSION_LINK, CONSIGN_LINK } from '../src/art.js';
import { findContactLinks } from '../src/contacts.js';
import { relevanceFields, scrapeQuery, pickCity, cityFromAddress, regionFromAddress } from '../src/maps.js';
import { extractFeedCards, extractDetail } from '../src/dom-extract.js';
import { isMobile, classifyWhatsApp, fixMissingCode, WA, loadWhatsAppTemplate } from '../src/whatsapp.js';
import { loadTemplate, renderEmail } from '../src/email-template.js';
import { createSaver } from '../src/output.js';
import { runKey, resumePoint, queryFingerprint } from '../src/resume.js';

const WORLD = resolveCountry({ country: 'WORLD', campaign: 'art' });
const COUNTRIES_30 = ['UK', 'FR', 'DE', 'CH', 'IT', 'ES', 'NL', 'BE', 'AT', 'SE', 'DK', 'NO', 'IE', 'PT', 'MC', 'HK', 'SG', 'JP', 'KR', 'TW', 'IN', 'AE', 'AU', 'NZ', 'CA', 'MX', 'BR', 'AR', 'CO', 'ZA'];
/** Every other European market of the sushi run but Russia and Belarus, then the Gulf, the Levant, South America, Southeast Asia and Africa. */
const MORE_EUROPE = ['BG', 'HR', 'CY', 'CZ', 'EE', 'FI', 'GR', 'HU', 'LV', 'LT', 'LU', 'MT', 'PL', 'RO', 'SK', 'SI', 'IS', 'LI', 'AD', 'SM', 'RS', 'BA', 'ME', 'MK', 'AL', 'XK', 'MD', 'UA', 'TR'];
const MORE_WORLD = ['QA', 'SA', 'KW', 'LB', 'CL', 'PE', 'UY', 'TH', 'ID', 'PH', 'MY', 'VN', 'NG', 'KE', 'EG', 'MA', 'GH'];
const COUNTRIES_76 = [...COUNTRIES_30, ...MORE_EUROPE, ...MORE_WORLD];
/** A place found by the world run, searched as `code`. */
const place = (business_name, category, extra = {}) => ({ business_name, category, country: 'FR', campaign: 'art', ...extra });
const tierOf = (lead, siteText = '') => scoreRelevance(lead, siteText).tier;
const fieldsOf = (lead, siteText = '', links = []) => relevanceFields({ ...lead, _siteLinks: links }, siteText);
/** A market as scrapeQuery merges it over the profile. */
const marketAs = (code) => ({ ...WORLD, code, ...WORLD_MARKETS[code], trunks: WORLD_MARKETS[code].trunks || ['0'], districtTowns: !!WORLD_MARKETS[code].districtTowns });

function assertContract(row) {
    const label = row.business_name;
    assert.ok(['gallery', 'auction_house', 'dealer', 'art_advisor', ''].includes(row.art_type), `${label}: art_type ${row.art_type}`);
    assert.ok(['yes', 'no', 'unknown'].includes(row.accepts_submissions), `${label}: accepts_submissions`);
    assert.ok(['yes', 'unknown'].includes(row.accepts_consignments), `${label}: accepts_consignments`);
    for (const k of ['submission_url', 'consign_url']) assert.match(row[k], /^(https?:\/\/\S+)?$/, `${label}: ${k}`);
    const vocabulary = SPECIALTIES.map(([w]) => w);
    if (row.specialties) for (const s of row.specialties.split('; ')) assert.ok(vocabulary.includes(s), `${label}: specialty "${s}"`);
    const type = { Gallery: 'gallery', 'Auction house': 'auction_house', 'Art dealer': 'dealer', 'Art advisor': 'art_advisor' }[row.relevance_tier] || '';
    assert.equal(row.art_type, type, `${label}: art_type for ${row.relevance_tier}`);
}

test('world art: 76 countries, 181 art cities, 155 gallery districts, one run that never resumes another', () => {
    assert.equal(WORLD.code, 'WORLD');
    assert.equal(WORLD.campaign, 'art');
    assert.equal(WORLD.outputDir, 'output-world-art');
    assert.equal(WORLD.script, 'art:world');
    assert.equal(WORLD.workbook, 'art-leads.xlsx');
    assert.deepEqual(WORLD.includeTiers, ['Gallery', 'Auction house', 'Art dealer', 'Art advisor']);
    assert.deepEqual(WORLD.highYield, ['Art gallery', 'Auction house', 'Art dealer', 'Art advisor']);
    for (const name of ['World', 'worldwide', 'GLOBAL']) assert.equal(resolveCountry({ country: name, campaign: 'art' }).code, 'WORLD');
    assert.throws(() => resolveCountry({ country: 'WORLD' }), /campaign only/);
    assert.throws(() => resolveCountry({ country: 'WORLD', campaign: 'sushi' }), /Israel, Europe only/);
    // Germany alone: the error says how.
    assert.throws(() => resolveCountry({ country: 'DE', campaign: 'art' }), /"country": "WORLD", "states": \["DE"\]/);

    assert.deepEqual(Object.keys(WORLD.regions), COUNTRIES_76);
    assert.deepEqual(Object.keys(WORLD_MARKETS), COUNTRIES_76);
    for (const code of COUNTRIES_76) {
        const m = WORLD_MARKETS[code];
        assert.ok(m && m.gl && m.phoneCode && m.name, code);
        assert.ok(WORLD.regions[code].length > 0, code);
    }
    // The rest of Europe reuses the sushi run's entries (gl, phone code, trunks, names).
    for (const code of MORE_EUROPE) {
        for (const k of ['name', 'gl', 'phoneCode', 'trunks', 'names']) assert.deepEqual(WORLD_MARKETS[code][k], EUROPE_MARKETS[code][k], `${code} ${k}`);
    }
    // The US and Israel have their own runs; mainland China is left out; Russia and Belarus too (sanctions).
    for (const code of ['US', 'IL', 'CN', 'RU', 'BY']) assert.ok(!WORLD_MARKETS[code] && !WORLD.regions[code], code);
    const warnings = [];
    assert.deepEqual(resolveLocations({ country: 'WORLD', campaign: 'art', states: ['RU', 'BY'] }, (m) => warnings.push(m)), []);
    assert.equal(warnings.length, 2);
    // Country names are English, for country_name.
    assert.deepEqual(['UK', 'KR', 'AE', 'MX', 'BR', 'HK'].map(c => WORLD_MARKETS[c].name), ['United Kingdom', 'South Korea', 'United Arab Emirates', 'Mexico', 'Brazil', 'Hong Kong']);
    assert.deepEqual(['CZ', 'TR', 'MK', 'BA', 'XK', 'SA', 'VN', 'PH'].map(c => WORLD_MARKETS[c].name),
        ['Czechia', 'Türkiye', 'North Macedonia', 'Bosnia and Herzegovina', 'Kosovo', 'Saudi Arabia', 'Vietnam', 'Philippines']);
    // A market's gl is its ISO code (UK is gb).
    for (const code of [...MORE_EUROPE, ...MORE_WORLD]) assert.equal(WORLD_MARKETS[code].gl, code.toLowerCase(), code);

    const cities = Object.values(WORLD.regions).flat();
    assert.equal(cities.length, 181);
    assert.equal(Object.values(WORLD.districts).flat().length, 155);
    for (const city of ['Budapest', 'Szentendre', 'Prague', 'Warsaw', 'Kraków', 'Łódź', 'Athens', 'Thessaloniki', 'Istanbul', 'Ankara', 'Bucharest', 'Cluj-Napoca', 'Sofia', 'Zagreb',
        'Ljubljana', 'Bratislava', 'Helsinki', 'Tallinn', 'Riga', 'Vilnius', 'Belgrade', 'Kyiv', 'Lviv', 'Reykjavík', 'Vaduz', 'Luxembourg', 'Valletta', 'Nicosia', 'Tirana', 'Pristina',
        'Doha', 'Riyadh', 'Jeddah', 'Kuwait City', 'Beirut', 'Santiago', 'Lima', 'Montevideo', 'Punta del Este', 'José Ignacio', 'Bangkok', 'Chiang Mai', 'Jakarta', 'Yogyakarta',
        'Ubud', 'Denpasar', 'Manila', 'Makati', 'Kuala Lumpur', 'Penang', 'Ho Chi Minh City', 'Hanoi', 'Lagos', 'Nairobi', 'Cairo', 'Marrakesh', 'Casablanca', 'Accra']) {
        assert.ok(cities.includes(city), city);
    }
    for (const city of ['Moscow', 'Saint Petersburg', 'Minsk']) assert.ok(!cities.includes(city), city);
    for (const city of ['London', 'Paris', 'Berlin', 'Basel', 'Geneva', 'Zurich', 'Maastricht', 'Venice', 'Milan', 'Brussels', 'Antwerp', 'Madrid', 'Barcelona', 'Lisbon',
        'Copenhagen', 'Stockholm', 'Vienna', 'Munich', 'Düsseldorf', 'Cologne', 'Monaco', 'Hong Kong', 'Singapore', 'Tokyo', 'Seoul', 'Taipei', 'Dubai', 'Abu Dhabi', 'Mumbai',
        'New Delhi', 'Sydney', 'Melbourne', 'Auckland', 'Toronto', 'Vancouver', 'Montreal', 'Mexico City', 'São Paulo', 'Buenos Aires', 'Bogotá', 'Cape Town', 'Johannesburg']) {
        assert.ok(cities.includes(city), city);
    }
    const locs = resolveLocations({ country: 'WORLD', campaign: 'art' }, () => {});
    for (const [city, state] of [['Mayfair, London', 'UK'], ["St James's, London", 'UK'], ['Shoreditch, London', 'UK'], ['Fitzrovia, London', 'UK'], ['Le Marais, Paris', 'FR'],
        ['Saint-Germain-des-Prés, Paris', 'FR'], ['Avenue Matignon, Paris', 'FR'], ['Mitte, Berlin', 'DE'], ['Kreuzberg, Berlin', 'DE'], ['Charlottenburg, Berlin', 'DE'],
        ['Central, Hong Kong', 'HK'], ['Wong Chuk Hang, Hong Kong', 'HK'], ['Ginza, Tokyo', 'JP'], ['Roppongi, Tokyo', 'JP'], ['Samcheong-dong, Seoul', 'KR'],
        ['Hannam-dong, Seoul', 'KR'], ['Roma Norte, Mexico City', 'MX'], ['Polanco, Mexico City', 'MX'], ['Jardins, São Paulo', 'BR'],
        ['District V, Budapest', 'HU'], ['Falk Miksa utca, Budapest', 'HU'], ['District VI, Budapest', 'HU'], ['District VII, Budapest', 'HU'], ['Beyoğlu, Istanbul', 'TR'],
        ['Karaköy, Istanbul', 'TR'], ['Nişantaşı, Istanbul', 'TR'], ['Prague 1, Prague', 'CZ'], ['Śródmieście, Warsaw', 'PL'], ['Kolonaki, Athens', 'GR'], ['Vitacura, Santiago', 'CL'],
        ['Bang Rak, Bangkok', 'TH'], ['Zamalek, Cairo', 'EG'], ['Victoria Island, Lagos', 'NG'], ['Mar Mikhael, Beirut', 'LB']]) {
        assert.ok(locs.some(l => l.city === city && l.state === state), city);
    }
    // 336 places, six terms each.
    assert.equal(locs.length, 336);
    assert.equal(buildQueryMatrix(locs, WORLD.categories, WORLD.highYield).length, 2016);
    // Every search runs as a country (never a bare "cities" list).
    assert.ok(locs.every(l => WORLD_MARKETS[l.state]));
    const q = buildQueryMatrix(locs, WORLD.categories, WORLD.highYield);
    assert.ok(q.slice(0, locs.length).every(x => x.category === 'Art gallery'));
    assert.equal(q[0].text, 'Art gallery London');
    assert.deepEqual([...new Set(resolveLocations({ country: 'WORLD', campaign: 'art', states: ['jp', 'BR'] }, () => {}).map(l => l.state))], ['JP', 'BR']);
    // Hungary alone, and Budapest alone (with its gallery districts).
    const hu = resolveLocations({ country: 'WORLD', campaign: 'art', states: ['HU'] }, () => {});
    assert.ok(hu.every(l => l.state === 'HU'));
    assert.deepEqual(hu.map(l => l.city).slice(0, 5), ['Budapest', 'Szentendre', 'Debrecen', 'Szeged', 'Pécs']);
    assert.deepEqual(resolveLocations({ country: 'WORLD', campaign: 'art', states: ['HU'], cities: ['Budapest'] }, () => {}).map(l => `${l.state} ${l.city}`),
        ['HU Budapest', 'HU District V, Budapest', 'HU Falk Miksa utca, Budapest', 'HU District VI, Budapest', 'HU District VII, Budapest']);
    // progress.json: WORLD-art never resumes the Europe sushi run or a US art run.
    assert.equal(runKey(WORLD), 'WORLD-art');
    assert.equal(runKey(resolveCountry({ country: 'EU', campaign: 'sushi' })), 'EU-sushi');
    const queries = Array.from({ length: 5 }, (_, i) => ({ text: `q${i}` }));
    assert.equal(resumePoint(queries, [], { country: 'US-art', queries: 5, next: 3 }, runKey(WORLD)), 0);
});

test('world art: input files and npm scripts (the smoke run is one city, 2 terms, 10 places, a visible browser)', () => {
    const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
    const pkg = read('package.json');
    assert.equal(pkg.scripts['art:world'], 'node src/main.js --input ./input.world-art.json');
    assert.equal(pkg.scripts['smoke:art:world'], 'node src/main.js --input ./input.world-art-smoke.json');
    const full = read('input.world-art.json');
    assert.equal(resolveCountry(full).code, 'WORLD');
    assert.deepEqual(full.includeTiers, WORLD.includeTiers);
    assert.equal(full.contacts.afterSearch, true);
    const smoke = read('input.world-art-smoke.json');
    const q = buildQueryMatrix(resolveLocations(smoke, () => {}), smoke.searchCategories, WORLD.highYield);
    assert.deepEqual(q.map(x => [x.text, x.state]), [['Art gallery London', 'UK'], ['Auction house London', 'UK']]);
    assert.equal(smoke.maxLeads, 10);
    assert.equal(smoke.browser.headless, false);
    assert.equal(smoke.outputDir, 'output-world-art-smoke');
    // Every country code is documented in the full input, with how to run Hungary or Budapest alone.
    for (const code of COUNTRIES_76) assert.match(full.states_comment, new RegExp(`\\b${code}\\b`), code);
    assert.match(full.states_comment, /\["HU"\]/);
    assert.match(full.states_comment, /Budapest/);
    assert.deepEqual(full.states, []);
    assert.deepEqual(resolveLocations(full, () => {}).length, 336);

    // The Hungary smoke run: Budapest, 2 terms, 10 places, a visible browser.
    assert.equal(pkg.scripts['smoke:art:hu'], 'node src/main.js --input ./input.world-art-hu-smoke.json');
    const hu = read('input.world-art-hu-smoke.json');
    assert.equal(resolveCountry(hu).code, 'WORLD');
    const qhu = buildQueryMatrix(resolveLocations(hu, () => {}), hu.searchCategories, WORLD.highYield);
    assert.deepEqual(qhu.map(x => [x.text, x.state]), [['Art gallery Budapest', 'HU'], ['Auction house Budapest', 'HU']]);
    assert.equal(hu.maxLeads, 10);
    assert.equal(hu.browser.headless, false);
    assert.equal(hu.outputDir, 'output-world-art-hu-smoke');
});

test('world art: national phone numbers get each market\'s code, trunk and length', () => {
    const read = (tel, code) => {
        const dom = new JSDOM(`<div role="main"><h1 class="DUwDvf">X</h1><button data-item-id="phone:tel:${tel}"></button></div>`, { url: 'https://www.google.com/maps/place/x' });
        const prev = global.document;
        global.document = dom.window.document;
        const m = WORLD_MARKETS[code];
        try { return extractDetail(m.phoneCode, m.trunks || ['0'], m.nationalLengths || [10]).phone; } finally { global.document = prev; }
    };
    for (const [tel, code, phone] of [
        ['2523 1234', 'HK', '+85225231234'],
        ['6123 4567', 'SG', '+6561234567'],
        ['03-1234-5678', 'JP', '+81312345678'],
        ['090-1234-5678', 'JP', '+819012345678'],
        ['3-1234-5678', 'JP', '+81312345678'],
        ['02-1234-5678', 'KR', '+82212345678'],
        ['010-1234-5678', 'KR', '+821012345678'],
        ['02 2345 6789', 'TW', '+886223456789'],
        ['0912 345 678', 'TW', '+886912345678'],
        ['022 2202 1234', 'IN', '+912222021234'],
        ['98200 12345', 'IN', '+919820012345'],
        ['04 123 4567', 'AE', '+97141234567'],
        ['050 123 4567', 'AE', '+971501234567'],
        ['(02) 9123 4567', 'AU', '+61291234567'],
        ['0412 345 678', 'AU', '+61412345678'],
        ['09 123 4567', 'NZ', '+6491234567'],
        ['(416) 555-0100', 'CA', '+14165550100'],
        ['1 416-555-0100', 'CA', '+14165550100'],
        ['55 1234 5678', 'MX', '+525512345678'],
        ['01 55 1234 5678', 'MX', '+525512345678'],
        ['044 55 1234 5678', 'MX', '+525512345678'],
        ['(11) 3061-1234', 'BR', '+551130611234'],
        ['(11) 98765-4321', 'BR', '+5511987654321'],
        ['(011) 3061-1234', 'BR', '+551130611234'],
        ['011 4123-4567', 'AR', '+541141234567'],
        ['(601) 234 5678', 'CO', '+576012345678'],
        ['310 123 4567', 'CO', '+573101234567'],
        ['021 123 4567', 'ZA', '+27211234567'],
        // The European entries read as in the sushi run.
        ['02 1234 5678', 'IT', '+390212345678'],
        ['020 7946 0000', 'UK', '+442079460000'],
        ['+81 3-1234-5678', 'BR', '+81312345678'],
        // The rest of Europe: the sushi run's trunks, and the length of a number written without its 0.
        ['02 123 4567', 'BG', '+35921234567'],
        ['088 123 4567', 'BG', '+359881234567'],
        ['01 4567 890', 'HR', '+38514567890'],
        ['091 123 4567', 'HR', '+385911234567'],
        ['22 123456', 'CY', '+35722123456'],
        ['224 123 456', 'CZ', '+420224123456'],
        ['640 1234', 'EE', '+3726401234'],
        ['09 1234 567', 'FI', '+35891234567'],
        ['210 123 4567', 'GR', '+302101234567'],
        ['06 1 234 5678', 'HU', '+3612345678'],
        ['(1) 234 5678', 'HU', '+3612345678'],
        ['06 30 123 4567', 'HU', '+36301234567'],
        ['30 123 4567', 'HU', '+36301234567'],
        ['6712 3456', 'LV', '+37167123456'],
        ['8 5 212 3456', 'LT', '+37052123456'],
        ['2122 1234', 'MT', '+35621221234'],
        ['22 123 45 67', 'PL', '+48221234567'],
        ['021 123 4567', 'RO', '+40211234567'],
        ['02 1234 5678', 'SK', '+421212345678'],
        ['01 123 45 67', 'SI', '+38611234567'],
        ['551 2345', 'IS', '+3545512345'],
        ['232 12 34', 'LI', '+4232321234'],
        ['812 345', 'AD', '+376812345'],
        ['0549 123456', 'SM', '+3780549123456'],
        ['011 123 4567', 'RS', '+381111234567'],
        ['033 123 456', 'BA', '+38733123456'],
        ['020 123 456', 'ME', '+38220123456'],
        ['02 3123 456', 'MK', '+38923123456'],
        ['04 222 3456', 'AL', '+35542223456'],
        ['038 123 456', 'XK', '+38338123456'],
        ['022 123 456', 'MD', '+37322123456'],
        ['044 123 4567', 'UA', '+380441234567'],
        ['0212 123 45 67', 'TR', '+902121234567'],
        ['212 123 45 67', 'TR', '+902121234567'],
        // The Gulf, the Levant, South America, Southeast Asia, Africa.
        ['4412 3456', 'QA', '+97444123456'],
        ['011 234 5678', 'SA', '+966112345678'],
        ['050 123 4567', 'SA', '+966501234567'],
        ['2222 3333', 'KW', '+96522223333'],
        ['01 234 567', 'LB', '+9611234567'],
        ['70 123 456', 'LB', '+96170123456'],
        ['2 2345 6789', 'CL', '+56223456789'],
        ['(02) 2345 6789', 'CL', '+56223456789'],
        ['9 8765 4321', 'CL', '+56987654321'],
        ['(01) 234 5678', 'PE', '+5112345678'],
        ['987 654 321', 'PE', '+51987654321'],
        ['2915 1234', 'UY', '+59829151234'],
        ['099 123 456', 'UY', '+59899123456'],
        ['02 123 4567', 'TH', '+6621234567'],
        ['081 234 5678', 'TH', '+66812345678'],
        ['(021) 1234 5678', 'ID', '+622112345678'],
        ['0812 3456 7890', 'ID', '+6281234567890'],
        ['(0361) 123 456', 'ID', '+62361123456'],
        ['(02) 8123 4567', 'PH', '+63281234567'],
        ['0917 123 4567', 'PH', '+639171234567'],
        ['03-1234 5678', 'MY', '+60312345678'],
        ['012-345 6789', 'MY', '+60123456789'],
        ['028 1234 5678', 'VN', '+842812345678'],
        ['090 123 4567', 'VN', '+84901234567'],
        ['01 234 5678', 'NG', '+23412345678'],
        ['0803 123 4567', 'NG', '+2348031234567'],
        ['020 123 4567', 'KE', '+254201234567'],
        ['0712 345 678', 'KE', '+254712345678'],
        ['02 2345 6789', 'EG', '+20223456789'],
        ['010 1234 5678', 'EG', '+201012345678'],
        ['0522 12 34 56', 'MA', '+212522123456'],
        ['0612 34 56 78', 'MA', '+212612345678'],
        ['030 123 4567', 'GH', '+233301234567'],
        ['024 123 4567', 'GH', '+233241234567'],
    ]) assert.equal(read(tel, code), phone, `${code} ${tel}`);

    // WhatsApp: mobiles in the new markets are "Likely", landlines "Check", +1 is unknowable.
    for (const n of ['+85291234567', '+6591234567', '+819012345678', '+821012345678', '+886912345678', '+919820012345', '+971501234567', '+61412345678',
        '+64211234567', '+5511987654321', '+5491141234567', '+573101234567', '+27821234567', '+393331234567', '+34612345678', '+351912345678', '+46701234567',
        '+4791234567', '+353861234567', '+377612345678']) assert.ok(isMobile(n), n);
    for (const n of ['+85225231234', '+6561234567', '+81312345678', '+82212345678', '+97141234567', '+61291234567', '+551130611234', '+576012345678', '+27211234567', '+390212345678'])
        assert.ok(!isMobile(n), n);
    // …and in the countries added later.
    for (const n of ['+359881234567', '+385911234567', '+35799123456', '+420601234567', '+3725123456', '+358401234567', '+306912345678', '+36301234567', '+37121234567',
        '+37061234567', '+35679123456', '+48501234567', '+40721123456', '+421903123456', '+38641123456', '+3546123456', '+4237912345', '+376312345', '+37866123456',
        '+381641234567', '+38761123456', '+38267123456', '+38970123456', '+355691234567', '+38344123456', '+37369123456', '+380501234567', '+905321234567',
        '+97455123456', '+966501234567', '+96550012345', '+9613123456', '+96170123456', '+56987654321', '+51987654321', '+59899123456', '+66812345678', '+6281234567890',
        '+639171234567', '+60123456789', '+84901234567', '+2348031234567', '+254712345678', '+201012345678', '+212612345678', '+233241234567']) assert.ok(isMobile(n), n);
    for (const n of ['+35921234567', '+38514567890', '+420224123456', '+302101234567', '+3612345678', '+48221234567', '+40211234567', '+380441234567', '+902121234567',
        '+97444123456', '+966112345678', '+96522223333', '+9611234567', '+56223456789', '+5112345678', '+59829151234', '+6621234567', '+622112345678', '+63281234567',
        '+60312345678', '+842812345678', '+23412345678', '+254201234567', '+20223456789', '+212522123456', '+233301234567']) assert.ok(!isMobile(n), n);
    assert.equal(classifyWhatsApp({ phone: '+36301234567' }).status, WA.MOBILE);
    assert.equal(classifyWhatsApp({ phone: '+3612345678' }).status, WA.LANDLINE);
    // A Hungarian site's "wa.me/06301234567" keeps neither the 06 nor a missing code; a Turkish "wa.me/5321234567" is +90.
    assert.equal(fixMissingCode('+5321234567', '90'), '+905321234567');
    assert.equal(fixMissingCode('+48 0501 234 567', '48'), '+48501234567');
    assert.equal(classifyWhatsApp({ phone: '+61412345678' }).status, WA.MOBILE);
    assert.equal(classifyWhatsApp({ phone: '+61291234567' }).status, WA.LANDLINE);
    assert.equal(classifyWhatsApp({ phone: '+14165550100' }).status, WA.UNKNOWN);
    // A Colombian site's "wa.me/3101234567" is +57 310…, not the Netherlands with its 0 kept.
    assert.equal(fixMissingCode('+3101234567', '57'), '+573101234567');
    assert.equal(fixMissingCode('+81 090 1234 5678', ''), '+819012345678');
    assert.equal(fixMissingCode('+972 058 123 4567', '972'), '+972581234567', 'Israel unchanged');
});

test('world art: the town and region come from the address in every market\'s format', () => {
    for (const [address, code, city, region] of [
        ['6 Chome-10-1 Roppongi, Minato City, Tokyo 106-6108', 'JP', 'Tokyo', 'Tokyo'],
        ['1-chōme-8-6 Ginza, Chuo City, Tokyo 104-0061, Japan', 'JP', 'Tokyo', 'Tokyo'],
        ['570-2 Gionmachi Minamigawa, Higashiyama Ward, Kyoto, 605-0074', 'JP', 'Kyoto', 'Kyoto'],
        ['Kita Ward, Osaka, 530-0001', 'JP', 'Osaka', 'Osaka'],
        ['1 Chome-1 Minatomirai, Naka Ward, Yokohama, Kanagawa 231-0023', 'JP', 'Yokohama', 'Kanagawa'],
        ['3419 Naoshima, Kagawa District, Kagawa 761-3110', 'JP', 'Naoshima', 'Kagawa'],
        ['54 Samcheong-ro, Jongno-gu, Seoul 03053', 'KR', 'Seoul', ''],
        ['Seoul, Jongno-gu, Samcheong-ro, 54', 'KR', 'Seoul', ''],
        ['123 Pangyo-ro, Bundang-gu, Seongnam-si, Gyeonggi-do', 'KR', 'Seongnam', 'Gyeonggi-do'],
        ['G/F, 50 Connaught Rd Central, Central, Hong Kong', 'HK', 'Hong Kong', ''],
        ['1 Fullerton Rd, #02-01, Singapore 049213', 'SG', 'Singapore', ''],
        ['No. 1號, Zhongzheng District, Taipei City, 100', 'TW', 'Taipei', ''],
        ['No. 2, Lane 4, Xinyi District, Taipei, Taiwan 110', 'TW', 'Taipei', ''],
        ['Kala Ghoda, Fort, Mumbai, Maharashtra 400001', 'IN', 'Mumbai', 'Maharashtra'],
        ['Hauz Khas Village, New Delhi, Delhi 110016, India', 'IN', 'New Delhi', 'Delhi'],
        ['Alserkal Avenue - Street 8 - Al Quoz - Al Quoz Industrial Area 1 - Dubai - United Arab Emirates', 'AE', 'Dubai', 'Dubai'],
        ['Saadiyat Cultural District, Abu Dhabi', 'AE', 'Abu Dhabi', 'Abu Dhabi'],
        ['Hili, Al Ain', 'AE', 'Al Ain', 'Abu Dhabi'],
        ['2 Danks St, Waterloo NSW 2017', 'AU', 'Waterloo', 'NSW'],
        ['Level 1, 10 Gertrude St, Fitzroy VIC 3065, Australia', 'AU', 'Fitzroy', 'VIC'],
        ['123 Ponsonby Rd, Ponsonby, Auckland 1011', 'NZ', 'Auckland', ''],
        ['1 Spadina Ave, Toronto, ON M5V 2T6', 'CA', 'Toronto', 'ON'],
        ['372 Rue Sainte-Catherine O, Montréal, QC H3B 1A2, Canada', 'CA', 'Montréal', 'QC'],
        ['Colima 196, Roma Nte., Cuauhtémoc, 06700 Ciudad de México, CDMX', 'MX', 'Ciudad de México', 'CDMX'],
        ['Av. Chapultepec 480, Juárez, 44600 Guadalajara, Jal., Mexico', 'MX', 'Guadalajara', 'Jal.'],
        ['R. Oscar Freire, 379 - Jardins, São Paulo - SP, 01426-001', 'BR', 'São Paulo', 'SP'],
        ['R. Jardim Botânico, 414 - Jardim Botânico, Rio de Janeiro - RJ, 22461-000, Brazil', 'BR', 'Rio de Janeiro', 'RJ'],
        ['Av. Alvear 1891, C1129 CABA', 'AR', 'Buenos Aires', ''],
        ['Cl. 10 #5-51, La Candelaria, Bogotá, Cundinamarca', 'CO', 'Bogotá', 'Cundinamarca'],
        ['71 Loop St, Cape Town City Centre, Cape Town, 8001', 'ZA', 'Cape Town', ''],
        ['44 Stanley Ave, Milpark, Johannesburg, 2092, South Africa', 'ZA', 'Johannesburg', ''],
        ['Talstrasse 66, 8001 Zürich', 'CH', 'Zürich', ''],
        ['Bredgade 1, 1260 København K', 'DK', 'København', ''],
        ['6 Burlington Gardens, London W1S 3ET', 'UK', 'London', ''],
        ['Rue de Seine 1, 75006 Paris', 'FR', 'Paris', ''],
        // The rest of Europe. Hungary names the town first; Croatia and Albania can put the postcode alone before it;
        // Latvia and Moldova write "LV-1010", "MD-2001"; Lithuania the municipality after the postcode.
        ['Budapest, Falk Miksa u. 10, 1055', 'HU', 'Budapest', ''],
        ['Budapest, Andrássy út, 1062 Hungary', 'HU', 'Budapest', ''],
        ['Szentendre, Bogdányi út 51, 2000', 'HU', 'Szentendre', ''],
        ['Váci u. 1, Budapest, 1052', 'HU', 'Budapest', ''],
        ['Sofia Center, ul. "Graf Ignatiev" 15, 1000 Sofia', 'BG', 'Sofia', ''],
        ['Ilica 1, 10000, Zagreb', 'HR', 'Zagreb', ''],
        ['Ilica 1, 10000 Zagreb, Croatia', 'HR', 'Zagreb', ''],
        ['Ledras 1, Nicosia 1011', 'CY', 'Nicosia', ''],
        ['Malostranské nám. 1, 118 00 Malá Strana', 'CZ', 'Malá Strana', ''],
        ['Telliskivi 60a, 10412 Tallinn', 'EE', 'Tallinn', ''],
        ['Mannerheimintie 2, 00100 Helsinki', 'FI', 'Helsinki', ''],
        ['Patriarchou Ioakim 1, Athina 106 74', 'GR', 'Athina', ''],
        ['Brīvības iela 32, Centra rajons, Rīga, LV-1010', 'LV', 'Rīga', ''],
        ['Gedimino pr. 9, Vilnius, 01103 Vilniaus m. sav.', 'LT', 'Vilnius', ''],
        ['Rue X 1, L-1724 Luxembourg', 'LU', 'Luxembourg', ''],
        ['Republic St, Valletta VLT 1117', 'MT', 'Valletta', ''],
        ['Mazowiecka 7, 00-052 Warszawa', 'PL', 'Warszawa', ''],
        ['Str. Arthur Verona 13-15, București 010312', 'RO', 'București', ''],
        ['Panská 2, 811 01 Bratislava-Staré Mesto', 'SK', 'Bratislava-Staré Mesto', ''],
        ['Prešernov trg 1, 1000 Ljubljana', 'SI', 'Ljubljana', ''],
        ['Laugavegur 1, 101 Reykjavík', 'IS', 'Reykjavík', ''],
        ['Städtle 32, 9490 Vaduz', 'LI', 'Vaduz', ''],
        ['Av. Meritxell, 25, AD500 Andorra la Vella', 'AD', 'Andorra la Vella', ''],
        ['Contrada Omagnano, 47890 San Marino', 'SM', 'San Marino', ''],
        ['Knez Mihailova 46, Beograd 11000', 'RS', 'Beograd', ''],
        ['Ferhadija 1, Sarajevo 71000', 'BA', 'Sarajevo', ''],
        ['Njegoševa 1, Podgorica 81000', 'ME', 'Podgorica', ''],
        ['Makedonija 1, Skopje 1000', 'MK', 'Skopje', ''],
        ['Rruga e Durrësit, 1001, Tiranë', 'AL', 'Tiranë', ''],
        ['Rr. Nënë Tereza, Prishtinë 10000', 'XK', 'Prishtinë', ''],
        ['Strada București 1, Chișinău, MD-2001', 'MD', 'Chișinău', ''],
        ['Khreshchatyk St, 22, Kyiv, 02000', 'UA', 'Kyiv', ''],
        ['Rynok Square, 1, Lviv, Lviv Oblast, 79000', 'UA', 'Lviv', 'Lviv Oblast'],
        ['Meşrutiyet Cd. No:99, 34430 Beyoğlu/İstanbul', 'TR', 'İstanbul', 'İstanbul'],
        ['Kavaklıdere, Tunus Cd. No:5, 06680 Çankaya/Ankara, Türkiye', 'TR', 'Ankara', 'Ankara'],
        ['Kumbahçe, Cumhuriyet Cd. No:1, 48400 Bodrum/Muğla', 'TR', 'Bodrum', 'Muğla'],
        // The Gulf and the Levant: no postcode before the town; the governorate is the region.
        ['Katara Cultural Village, Building 18, Doha', 'QA', 'Doha', ''],
        ['7542 Prince Mohammed Bin Abdulaziz Rd, Al Olaya, Riyadh 12241', 'SA', 'Riyadh', ''],
        ['Al Shati, Jeddah 23411 2810, Saudi Arabia', 'SA', 'Jeddah', ''],
        ['Arabian Gulf St, Kuwait City', 'KW', 'Kuwait City', ''],
        ['Block 3, Street 1, Salmiya, Hawalli Governorate', 'KW', 'Salmiya', 'Hawalli'],
        ['Armenia St, Mar Mikhael, Beirut', 'LB', 'Beirut', ''],
        // South America.
        ['Alonso de Córdova 3053, 7630000 Vitacura, Región Metropolitana', 'CL', 'Vitacura', 'Región Metropolitana'],
        ['Cerro Alegre, Valparaíso, Región de Valparaíso', 'CL', 'Valparaíso', 'Región de Valparaíso'],
        ['Av. Pedro de Osma 135, Barranco 15063', 'PE', 'Barranco', ''],
        ['Jr. Junín 300, Miraflores 15074, Lima', 'PE', 'Miraflores', 'Lima'],
        ['Bartolomé Mitre 1350, 11000 Montevideo, Departamento de Montevideo', 'UY', 'Montevideo', 'Montevideo'],
        ['Calle 20, 20100 Punta del Este, Departamento de Maldonado', 'UY', 'Punta del Este', 'Maldonado'],
        ['Ruta 10, 20402 José Ignacio, Maldonado Department, Uruguay', 'UY', 'José Ignacio', 'Maldonado'],
        // Southeast Asia: the province before the postcode is the region.
        ['1 Charoen Krung Rd, Khwaeng Bang Rak, Khet Bang Rak, Krung Thep Maha Nakhon 10500', 'TH', 'Bangkok', 'Bangkok'],
        ['ถนนเจริญกรุง แขวงบางรัก เขตบางรัก กรุงเทพมหานคร 10500', 'TH', 'Bangkok', 'Bangkok'],
        ['Nimmanhaemin Rd, Su Thep, Mueang Chiang Mai District, Chiang Mai 50200', 'TH', 'Chiang Mai', 'Chiang Mai'],
        ['San Kamphaeng District, Chiang Mai 50130', 'TH', 'San Kamphaeng', 'Chiang Mai'],
        ['Jl. Kemang Raya No.8, Bangka, Kec. Mampang Prpt., Kota Jakarta Selatan, Daerah Khusus Ibukota Jakarta 12730', 'ID', 'Jakarta', 'Jakarta'],
        ['Jl. Raya Sanggingan, Kedewatan, Kecamatan Ubud, Kabupaten Gianyar, Bali 80571', 'ID', 'Ubud', 'Bali'],
        ['Jl. Gajah Mada No.1, Dauh Puri Kangin, Kec. Denpasar Bar., Kota Denpasar, Bali 80112', 'ID', 'Denpasar', 'Bali'],
        ['Jl. Braga No.1, Braga, Kec. Sumur Bandung, Kota Bandung, Jawa Barat 40111', 'ID', 'Bandung', 'Jawa Barat'],
        ['Jl. Raya Ubud, Ubud, Gianyar Regency, Bali 80571', 'ID', 'Ubud', 'Bali'],
        ['Karrivin Plaza, 2316 Chino Roces Ave Ext, Makati, 1231 Metro Manila', 'PH', 'Makati', 'Metro Manila'],
        ['Pasong Tamo, Makati City, Metro Manila', 'PH', 'Makati', 'Metro Manila'],
        ['Tomas Morato Ave, Quezon City, 1103 Metro Manila', 'PH', 'Quezon City', 'Metro Manila'],
        ['Jalan Bukit Bintang, Bukit Bintang, 55100 Kuala Lumpur, Wilayah Persekutuan Kuala Lumpur', 'MY', 'Kuala Lumpur', 'Kuala Lumpur'],
        ['Lebuh Armenian, George Town, 10200 George Town, Pulau Pinang', 'MY', 'George Town', 'Pulau Pinang'],
        ['15 Lê Thánh Tôn, Bến Nghé, Quận 1, Thành phố Hồ Chí Minh 700000', 'VN', 'Ho Chi Minh City', ''],
        ['Bến Nghé, District 1, Ho Chi Minh City, Vietnam', 'VN', 'Ho Chi Minh City', ''],
        ['Hàng Bài, Hoàn Kiếm, Hà Nội 100000', 'VN', 'Hanoi', ''],
        // Africa.
        ['1 Akin Adesola St, Victoria Island, Lagos 106104, Lagos', 'NG', 'Lagos', 'Lagos'],
        ['Plot 1, Wuse 2, Abuja 904101, Federal Capital Territory', 'NG', 'Abuja', 'Federal Capital Territory'],
        ['Peponi Rd, Westlands, Nairobi, 00100', 'KE', 'Nairobi', ''],
        ['1 Mohammed Mazhar, Zamalek, Cairo Governorate 4271130', 'EG', 'Cairo', 'Cairo'],
        ['Corniche, Hurghada, Red Sea Governorate', 'EG', 'Hurghada', 'Red Sea'],
        ['Rue Yves Saint Laurent, Marrakech 40090', 'MA', 'Marrakech', ''],
        ['Gueliz, Marrakech, Morocco', 'MA', 'Marrakech', ''],
        ['GA-123-4567, Accra, Greater Accra Region', 'GH', 'Accra', 'Greater Accra'],
    ]) {
        assert.equal(cityFromAddress(address, code), city, address);
        assert.equal(regionFromAddress(address, code), region, address);
    }
    // Australian addresses name the suburb: the searched city stays, unless the suburb is one.
    const AU = marketAs('AU');
    assert.equal(pickCity('2 Danks St, Waterloo NSW 2017', 'Sydney', AU), 'Sydney');
    assert.equal(pickCity('16 Flinders Ln, Melbourne VIC 3000', 'Sydney', AU), 'Melbourne');
    assert.equal(pickCity('', 'Paddington, Sydney', AU), 'Sydney');
    assert.equal(pickCity('1 Spadina Ave, Toronto, ON M5V 2T6', 'Queen West, Toronto', marketAs('CA')), 'Toronto');
    assert.equal(pickCity('G/F, 50 Connaught Rd Central, Central, Hong Kong', 'Central, Hong Kong', marketAs('HK')), 'Hong Kong');
    assert.equal(pickCity('Venloer Str. 1, 50823 Ehrenfeld', 'Cologne', marketAs('DE')), 'Cologne');
    // New Taipei is not Taipei.
    assert.equal(pickCity('No. 5, Banqiao District, New Taipei City, 220', 'Taipei', marketAs('TW')), 'New Taipei');
    // Prague's and Bratislava's districts, Santiago's communes and Lima's districts keep the searched city.
    assert.equal(pickCity('Malostranské nám. 1, 118 00 Malá Strana', 'Prague', marketAs('CZ')), 'Prague');
    assert.equal(pickCity('Václavské nám. 1, 110 00 Praha 1', 'Prague 1, Prague', marketAs('CZ')), 'Prague');
    assert.equal(pickCity('Údolní 1, 602 00 Brno-střed', 'Prague', marketAs('CZ')), 'Brno');
    assert.equal(pickCity('Panská 2, 811 01 Bratislava-Staré Mesto', 'Bratislava', marketAs('SK')), 'Bratislava');
    assert.equal(pickCity('Alonso de Córdova 3053, 7630000 Vitacura, Región Metropolitana', 'Vitacura, Santiago', marketAs('CL')), 'Santiago');
    assert.equal(pickCity('Av. Pedro de Osma 135, Barranco 15063', 'Lima', marketAs('PE')), 'Lima');
    assert.equal(pickCity('Calle Hatunrumiyoc 480, Cusco 08002', 'Lima', marketAs('PE')), 'Cusco');
    // Elsewhere the address town wins: Szentendre for a Budapest search, Bodrum, Makati, Ubud for a Denpasar search.
    assert.equal(pickCity('Szentendre, Bogdányi út 51, 2000', 'Budapest', marketAs('HU')), 'Szentendre');
    assert.equal(pickCity('Budapest, Falk Miksa u. 10, 1055', 'Falk Miksa utca, Budapest', marketAs('HU')), 'Budapest');
    assert.equal(pickCity('Jl. Raya Ubud, Ubud, Gianyar Regency, Bali 80571', 'Denpasar', marketAs('ID')), 'Ubud');
    assert.equal(pickCity('Triq il-Merkanti, Il-Belt Valletta VLT 1172', 'Valletta', marketAs('MT')), 'Valletta');

    // The Country column, and results outside the run.
    assert.equal(marketOfAddress('Alserkal Avenue - Al Quoz - Dubai - United Arab Emirates', WORLD_MARKETS), 'AE');
    assert.equal(marketOfAddress('6 Chome-10-1 Roppongi, Minato City, Tokyo 106-6108, Japan', WORLD_MARKETS), 'JP');
    assert.equal(marketOfAddress('Seoul, South Korea', WORLD_MARKETS), 'KR');
    assert.equal(marketOfAddress('Colima 196, 06700 Ciudad de México, CDMX, México', WORLD_MARKETS), 'MX');
    assert.equal(marketOfAddress('Hauptstraße 1, 79576 Weil am Rhein, Germany', WORLD_MARKETS), 'DE');
    for (const a of ['1000 Main St, Vancouver, WA 98660, United States', 'Av. da Praia Grande, Macau', 'Futian District, Shenzhen, Guangdong, China',
        'Gordon St 3, Tel Aviv-Yafo, Israel', 'Tverskaya St, 1, Moskva, 125009, Russia', 'Praspiekt Niezaliežnasci 1, Minsk, Belarus', 'Jalan Sultan, Bandar Seri Begawan, Brunei',
        'Yangon, Myanmar (Burma)', 'Rue Didouche Mourad, Algiers, Algeria', 'Rainbow St, Amman, Jordan', 'Av. Mariscal López, Asunción, Paraguay', 'Rue du Commerce, Lomé, Togo',
        'Avenida Arce, La Paz, Bolivia', 'Sisavangvong Rd, Luang Prabang, Laos']) assert.ok(WORLD.foreign.test(a), a);
    // The countries added later are inside the run, each with its English name.
    for (const [a, code] of [['Jalan Wong Ah Fook, 80000 Johor Bahru, Johor, Malaysia', 'MY'], ['Riyadh - Saudi Arabia', 'SA'], ['Budapest, Falk Miksa u. 10, 1055, Hungary', 'HU'],
        ['Budapest, Falk Miksa u. 10, 1055 Hungary', 'HU'], ['Panská 2, 811 01 Bratislava, Slovakia', 'SK'], ['Calle 20, 20100 Colonia del Sacramento, Uruguay', 'UY'],
        ['Meşrutiyet Cd. No:99, 34430 Beyoğlu/İstanbul, Türkiye', 'TR'], ['Václavské nám. 1, 110 00 Praha 1, Czechia', 'CZ'], ['Hàng Bài, Hoàn Kiếm, Hà Nội, Viet Nam', 'VN'],
        ['Makedonija 1, Skopje 1000, North Macedonia', 'MK'], ['Rr. Nënë Tereza, Prishtinë 10000, Kosovo', 'XK'], ['98000 Monaco', 'MC']]) {
        assert.ok(!WORLD.foreign.test(a), a);
        assert.equal(marketOfAddress(a, WORLD_MARKETS), code, a);
    }
    // "Hong Kong SAR, China" is Hong Kong, and keeps its town.
    assert.ok(!WORLD.foreign.test('G/F, 50 Connaught Rd Central, Central, Hong Kong SAR, China'));
    assert.equal(cityFromAddress('G/F, 50 Connaught Rd Central, Central, Hong Kong SAR, China', 'HK'), 'Hong Kong');
    assert.throws(() => resolveCountry({ country: 'JP', campaign: 'art' }), /"country": "WORLD", "states": \["JP"\]/);
    for (const a of ['Hauptstraße 1, 79576 Weil am Rhein, Germany', '68300 Saint-Louis, France', 'Stortorget 1, 211 22 Malmö, Sweden', 'Colima 196, 06700 Ciudad de México, CDMX',
        'R. Oscar Freire, 379 - Jardins, São Paulo - SP, 01426-001', 'Kala Ghoda, Fort, Mumbai, Maharashtra 400001', '2 Danks St, Waterloo NSW 2017']) assert.ok(!WORLD.foreign.test(a), a);
    // Public bodies beyond Europe and the US.
    for (const w of ['https://www.nga.gov.au/', 'https://www.mmca.go.kr/', 'https://www.tokyo.lg.jp/', 'https://www.inba.gob.mx/', 'https://www.art.edu.au/', 'https://www.bak.admin.ch/',
        'https://www.mec.gub.uy/', 'https://www.kadikoy.bel.tr/', 'https://www.kultura.gov.pl/', 'https://www.galnas-indonesia.go.id/', 'https://www.moc.gov.sa/', 'https://www.culture.gov.eg/'])
        assert.equal(isPublicBody({ website: w }), true, w);
    assert.equal(isPublicBody({ website: 'https://www.gallery.com.au/' }), false);
});

test('world art: galleries, auction houses, dealers and advisors named in other languages', () => {
    for (const [name, category, tier] of [
        ['Galerie Templon', 'Art gallery', 'Gallery'],
        ['Galleria Continua', '', 'Gallery'],
        ['Galería Elba Benítez', '', 'Gallery'],
        ['Galeria Luisa Strina', '', 'Gallery'],
        ['Galerij De Zwarte Panter', '', 'Gallery'],
        ['Galleri Nicolai Wallner', '', 'Gallery'],
        ['Kunstgalerie Bonn', 'Store', 'Gallery'],
        ['小山登美夫ギャラリー', '', 'Gallery'],
        ['ギャラリー小柳', 'Art gallery', 'Gallery'],
        ['국제갤러리', '', 'Gallery'],
        ['현대화랑', '', 'Gallery'],
        ['藝廊 Hanart', '', 'Gallery'],
        ['Maison de ventes Tajan', '', 'Auction house'],
        ['Ader commissaires-priseurs', '', 'Auction house'],
        ['Hôtel des ventes de Monte-Carlo', '', 'Auction house'],
        ['Dorotheum Auktionshaus', '', 'Auction house'],
        ['Bruun Rasmussen Kunstauktioner', '', 'Auction house'],
        ["Casa d'Aste Pandolfini", '', 'Auction house'],
        ['Finarte Aste', '', 'Auction house'],
        ['Ansorena Subastas', '', 'Auction house'],
        ['Bolsa de Arte Leilões', '', 'Auction house'],
        ['Veilinghuis AAG', '', 'Auction house'],
        ['毎日オークション', '', 'Auction house'],
        ['서울옥션', '', 'Auction house'],
        ['保利拍賣', '', 'Auction house'],
        ['Kunsthaus Lempertz', 'Auction house', 'Auction house'],
        ['Kunsthandel P. de Boer', '', 'Art dealer'],
        ['Kunsthandlung Hagemeier', '', 'Art dealer'],
        ["Marchand d'art Dupont", '', 'Art dealer'],
        ['Galerie Müller Kunsthandel', 'Art gallery', 'Art dealer'],
        ['Kunstberatung Schmidt', 'Consultant', 'Art advisor'],
        ['Anna Rossi Consulenza artistica', 'Consultant', 'Art advisor'],
        ['Asesoría de arte Gómez', 'Corporate office', 'Art advisor'],
    ]) assert.equal(tierOf(place(name, category)), tier, name);
    // The site decides for a bare name, in its own language.
    for (const [site, tier] of [
        ['Aktuelle Ausstellung: Malerei. Künstler der Galerie: A, B, C.', 'Gallery'],
        ['Expositions en cours. Nos artistes.', 'Gallery'],
        ['Mostre in corso. I nostri artisti.', 'Gallery'],
        ['Exposiciones actuales. Nuestros artistas.', 'Gallery'],
        ['現在の展覧会。取扱作家。', 'Gallery'],
        ['현재 전시. 전속 작가.', 'Gallery'],
        ['Wir kaufen Gemälde und Sammlungen.', 'Art dealer'],
        ['Nous achetons des tableaux et des successions.', 'Art dealer'],
        ['Kunstberatung für Sammler und Unternehmen.', 'Art advisor'],
        ['Unsere nächste Auktion. Ergebnisse der Auktion.', 'Auction house'],
    ]) assert.equal(tierOf(place('Sammlung Weber', ''), site), tier, site);
});

test('world art: framing, supplies, schools and studios are not buyers; museums, Kunsthallen, foundations and academies are non-profits', () => {
    for (const [name, category, provisional] of [
        ['Encadrement du Marais', 'Picture frame shop', false],
        ['Bilderrahmen Müller', 'Store', false],
        ['Cornici Rossi', 'Store', false],
        ['Marquería López', 'Store', false],
        ['Lijstenmakerij Jansen', 'Store', false],
        ['額縁のヤマモト', 'Store', false],
        ['Galerie & Encadrement Dupont', 'Art gallery', true],
        ['액자 갤러리', 'Store', true],
        ['Künstlerbedarf Boesner', 'Store', false],
        ['Malschule Farbenfroh', 'Art gallery', false],
        ['Atelier Dupont', 'Artist', false],
    ]) {
        const r = scoreRelevance(place(name, category));
        assert.equal(r.tier, 'Not a buyer', name);
        assert.equal(r.provisional, provisional, `${name}: provisional`);
    }
    assert.equal(tierOf(place('Galerie & Encadrement Dupont', 'Art gallery'), 'Expositions en cours et à venir. Vernissage jeudi.'), 'Gallery');
    assert.equal(tierOf(place('Galerie im Atelier', 'Art gallery')), 'Gallery');
    for (const [name, category] of [
        ["Musée d'Orsay", 'Art museum'],
        ['Museo del Prado', 'Art gallery'],
        ['Kunstmuseum Basel', 'Art gallery'],
        ['Kunsthalle Wien', 'Art gallery'],
        ['Kunstverein München', 'Art gallery'],
        ['Kunsthaus Zürich', 'Art gallery'],
        ['Fondation Cartier', 'Art gallery'],
        ['Fundación Juan March', 'Art gallery'],
        ['Fondazione Prada', 'Art gallery'],
        ['Fundação Serralves', 'Art gallery'],
        ['Moderna Museet', 'Art gallery'],
        ['Stedelijk Museum', 'Art gallery'],
        ["Centre d'art contemporain de Genève", 'Art gallery'],
        ['Pinacoteca de São Paulo', 'Art gallery'],
        ['Galleria Nazionale d\'Arte Moderna', 'Art gallery'],
        ['Accademia di Belle Arti di Brera', 'Art gallery'],
        ['森美術館', 'Art gallery'],
        ['국립현대미술관', 'Art gallery'],
        ['台北市立美術館', 'Art gallery'],
    ]) {
        const lead = place(name, category);
        assert.equal(isSellable(lead).ok, false, name);
        assert.equal(tierOf(lead), 'Non-profit / museum', name);
    }
    // The site says so: a UK charity, a gemeinnütziger Verein, an association loi 1901, a fundación sin ánimo de lucro.
    for (const site of ['The gallery is a registered charity no. 1012345.', 'Der Kunstverein ist ein gemeinnütziger Verein.', 'Association loi 1901.',
        'Es una fundación sin ánimo de lucro.', 'É uma associação cultural sem fins lucrativos.', '運営：公益財団法人 ABC']) {
        assert.equal(tierOf(place('Galerie X', 'Art gallery'), site), 'Non-profit / museum', site);
    }
    // "Museumsquartier", "Museumplein" are places.
    assert.equal(tierOf(place('Galerie im Museumsquartier', 'Art gallery')), 'Gallery');
});

test('world art: submissions and consignments in French, German, Italian, Spanish, Portuguese, Dutch, Japanese and Korean', () => {
    const subs = (site) => fieldsOf(place('Galerie X', 'Art gallery'), site).accepts_submissions;
    for (const site of [
        "Nous n'acceptons pas de candidatures spontanées d'artistes.",
        "La galerie n'examine plus aucun dossier d'artiste.",
        'Wir nehmen derzeit keine Bewerbungen von Künstlern an.',
        'Keine unaufgeforderten Mappen, bitte.',
        'Non accettiamo candidature spontanee di artisti.',
        'No aceptamos propuestas de artistas en este momento.',
        'Não aceitamos portfólios.',
        'Wij nemen momenteel geen aanmeldingen aan.',
        '作品の持ち込みはお断りしております。',
    ]) assert.equal(subs(site), 'no', site);
    for (const site of [
        'Appel à candidatures : envoyez votre dossier avant le 1er mars.',
        'Künstlerbewerbungen: Senden Sie uns Ihre Mappe per E-Mail.',
        'Invia il tuo portfolio alla galleria.',
        'Convocatoria abierta para artistas jóvenes.',
        'Convocatória para artistas 2026.',
        'Open oproep voor kunstenaars.',
        '作品募集のお知らせ',
        '작가 공모 안내',
    ]) assert.equal(subs(site), 'yes', site);
    // Job applications are not artists' work.
    assert.equal(subs('Nous n\'acceptons pas les candidatures spontanées pour des stages.'), 'unknown');
    assert.equal(subs('Wir nehmen keine Bewerbungen für Praktika an.'), 'unknown');

    const consign = (site) => fieldsOf(place('Maison de ventes X', 'Auction house'), site).accepts_consignments;
    for (const site of [
        'Vendre avec nous. Estimations gratuites et confidentielles.',
        'Einlieferungen für unsere nächste Auktion: kostenlose Schätzung.',
        'Richiedi una valutazione gratuita delle tue opere.',
        'Tasaciones gratuitas. Compramos obras de arte.',
        'Avaliação gratuita das suas obras.',
        'Gratis taxatie op maandag.',
        '美術品買取・無料査定いたします。',
        '위탁 판매 문의',
        '委託拍賣 徵集拍品',
    ]) assert.equal(consign(site), 'yes', site);
    // 委託 alone is the outsourcing line of a privacy notice; a refusal is unknown.
    assert.equal(consign('個人情報の取扱いを委託する場合があります。'), 'unknown');
    assert.equal(consign("Nous n'acceptons plus de dépôts. Estimations gratuites."), 'unknown');
    assert.equal(consign('Keine Einlieferungen. Kostenlose Schätzung.'), 'unknown');
    assert.equal(consign('Ventes passées et résultats.'), 'unknown');
});

test('world art: submission and consign links in other languages; jobs and "for sale" pages are neither; English links read as before', () => {
    const sub = (path, text = '') => SUBMISSION_LINK.test(`${path} ${text}`.trim());
    const con = (path, text = '') => CONSIGN_LINK.test(`${path} ${text}`.trim());
    for (const [p, t] of [['/appel-a-candidatures', ''], ['/kuenstlerbewerbung', 'Künstlerbewerbung'], ['/einreichungen', ''], ['/convocatoria-2026', ''], ['/convocatoria', 'Convocatória'],
        ['/open-oproep', ''], ['/candidature-artisti', ''], ['/news/1', '作品募集'], ['/notice', '작가 공모']]) assert.ok(sub(p, t), `${p} ${t}`);
    for (const [p, t] of [['/jobs', 'Bewerbung'], ['/recrutement', 'Candidature spontanée'], ['/einlieferung', 'Einlieferung'], ['/estimation', 'Demande d\'estimation']])
        assert.ok(!sub(p, t), `${p} ${t}`);
    for (const [p, t] of [['/vendre', 'Vendre'], ['/einlieferung', ''], ['/kunst-verkaufen', ''], ['/schaetzung', 'Schätzung'], ['/valutazioni', ''], ['/tasaciones', ''],
        ['/avaliacao', 'Avaliação'], ['/verkopen', ''], ['/taxatie', ''], ['/kaitori', '買取'], ['/satei', '査定'], ['/consign', '위탁 판매']]) assert.ok(con(p, t), `${p} ${t}`);
    for (const [p, t] of [['/verkauf', 'Verkauf'], ['/opere-in-vendita', 'Opere in vendita'], ['/obras-en-venta', 'Venta'], ['/expertise', 'Our expertise'], ['/about', 'Taxation and VAT']])
        assert.ok(!con(p, t), `${p} ${t}`);
    const f = fieldsOf(place('Maison de ventes X', 'Auction house'), '', [{ url: 'https://mdv.example/ventes', text: 'Ventes' }, { url: 'https://mdv.example/vendre', text: 'Vendre' },
        { url: 'https://mdv.example/appel-a-candidatures', text: 'Appel à candidatures' }]);
    assert.equal(f.consign_url, 'https://mdv.example/vendre');
    assert.equal(f.submission_url, 'https://mdv.example/appel-a-candidatures');
    // Contact links in Italian, Portuguese, Japanese and Korean.
    const links = findContactLinks('<a href="/contatti">Contatti</a><a href="/contato">Contato</a><a href="/inquiry">お問い合わせ</a><a href="/ko/contact-us">연락처</a><a href="/shop">Shop</a>', 'https://g.example/', { max: 6 });
    assert.deepEqual(links.sort(), ['https://g.example/contato', 'https://g.example/contatti', 'https://g.example/inquiry', 'https://g.example/ko/contact-us']);
});

test('world art: specialties from other languages stay English; credits, museum names and false friends do not count', () => {
    const spec = (site) => fieldsOf(place('Galerie X', 'Art gallery'), site).specialties;
    for (const [site, want] of [
        ['Art contemporain, photographie, sculpture et œuvres sur papier de jeunes artistes. Estampes et céramiques.', 'contemporary; photography; prints; sculpture; works on paper; ceramics; emerging artists'],
        ['Zeitgenössische Kunst, Fotografie, Skulptur, Arbeiten auf Papier, Druckgrafik, Keramik.', 'contemporary; photography; prints; sculpture; works on paper; ceramics'],
        ['Arte contemporanea, fotografia, scultura, opere su carta, incisioni, ceramica, giovani artisti.', 'contemporary; photography; prints; sculpture; works on paper; ceramics; emerging artists'],
        ['Arte contemporáneo, fotografía, escultura y obra gráfica de artistas emergentes.', 'contemporary; photography; prints; sculpture; emerging artists'],
        ['Arte contemporânea, fotografia, escultura, gravuras e cerâmica.', 'contemporary; photography; prints; sculpture; ceramics'],
        ['Hedendaagse kunst, fotografie, werken op papier, grafiek, keramiek.', 'contemporary; photography; prints; works on paper; ceramics'],
        ['現代美術、写真作品、彫刻、版画、陶芸、若手作家。', 'contemporary; photography; prints; sculpture; ceramics; emerging artists'],
        ['현대미술, 사진 작품, 조각, 판화, 도자, 신진 작가.', 'contemporary; photography; prints; sculpture; ceramics; emerging artists'],
        ['當代藝術、攝影作品、雕塑、版畫、陶瓷。', 'contemporary; photography; prints; sculpture; ceramics'],
        ['Alte Meister, Impressionismus und Klassische Moderne.', 'modern; impressionist; old masters'],
        ['Arte popular mexicano y arte latinoamericano.', 'latin american; folk art'],
        ['Kunsthandwerk und angewandte Kunst.', 'decorative arts'],
        ['日本画と古美術、民藝。', 'asian art; folk art'],
        // Credits and museum names say nothing.
        ['Fotografie: Max Mustermann. Photographie : Jean Dupont.', ''],
        ["Près du Musée d'Art Moderne de Paris et du Museo de Arte Contemporáneo. 東京都現代美術館。국립현대미술관. Museum für Moderne Kunst.", ''],
        // Aboriginal "Indigenous art" is not Native American; "Asian and Western art" is not the American West.
        ['Aboriginal art from Arnhem Land and the Western Desert; Indigenous artists.', ''],
        ['Asian and Western art from Hong Kong collections.', ''],
    ]) assert.equal(spec(site), want, site);
    // In the US they still count.
    assert.equal(fieldsOf({ business_name: 'Taos Gallery', category: 'Art gallery', country: 'US', campaign: 'art' }, 'Indigenous art and Western art of the American West.').specialties, 'native american; western art');
});

test('world art feed: each search runs as its country — code, phone, City, region, Country — and results from the US are dropped', async () => {
    const run = async (query, cards, details) => {
        let current = '';
        const calls = [];
        const page = {
            url: () => current || 'https://www.google.com/maps/search/x',
            goto: async (u) => { current = u; calls.push(u); },
            $: async (sel) => (sel === 'div[role="feed"]' || sel === 'h1.DUwDvf' ? {} : null),
            $$eval: async () => cards.length,
            waitForSelector: async () => {},
            bringToFront: async () => {},
            evaluate: async (fn, ...args) => {
                if (fn === extractFeedCards) return cards;
                if (fn === extractDetail) { calls.push(args); return details[current.match(/place\/(\w)/)[1]]; }
                return null;
            },
        };
        const allLeads = [];
        const logs = [];
        await scrapeQuery(page, query, { seen: new Set(), allLeads, log: (m) => logs.push(m) },
            { maxResultsPerQuery: 60, maxScrolls: 0, minReviews: 0, maxLeads: 100, delayBetweenListings: 0, keepNonProfits: false, country: WORLD });
        return { allLeads, calls, logs };
    };
    const card = (id, name, category) => ({ name, href: `https://www.google.com/maps/place/${id}/data=!1s0x1:0x${id}`, category, rating: 4.6, reviewCount: 70, closedFlag: false });

    const sydney = await run({ text: 'Art gallery Sydney', city: 'Sydney', state: 'AU' }, [
        card('a', 'Roslyn Oxley9 Gallery', 'Art gallery'),
        card('b', 'Tolarno Galleries', 'Art gallery'),
        card('c', 'Art Gallery of New South Wales', 'Art museum'),
        card('d', 'Paddington Framing', 'Picture frame shop'),
    ], {
        a: { name: 'Roslyn Oxley9 Gallery', address: '8 Soudan Ln, Paddington NSW 2021', category: 'Art gallery', phone: '+61293311919', rating: 4.6, reviews: 70, description: 'Contemporary art gallery' },
        b: { name: 'Tolarno Galleries', address: 'Level 4, 104 Exhibition St, Melbourne VIC 3000', category: 'Art gallery', phone: '+61412345678', rating: 4.7, reviews: 40 },
    });
    assert.match(sydney.calls[0], /\?hl=en&gl=au$/);
    assert.deepEqual(sydney.calls.filter(Array.isArray)[0], ['61', ['0'], [9, 10]], 'the Australian phone code, trunk and lengths');
    assert.deepEqual(sydney.allLeads.map(l => l.business_name), ['Roslyn Oxley9 Gallery', 'Tolarno Galleries']);
    assert.ok(sydney.logs.some(m => /non-profit:1 not-a-buyer:1/.test(m)));
    const [oxley, tolarno] = sydney.allLeads;
    assert.equal(oxley.city, 'Sydney', 'Paddington is a suburb');
    assert.equal(oxley.bundesland, 'NSW');
    assert.equal(oxley.country_name, 'Australia');
    assert.equal(oxley.country, 'AU');
    assert.equal(oxley.phone_code, '61');
    assert.equal(oxley.relevance_tier, 'Gallery');
    assert.equal(oxley.specialties, 'contemporary');
    assert.equal(tolarno.city, 'Melbourne');
    assert.equal(tolarno.bundesland, 'VIC');

    const vancouver = await run({ text: 'Art gallery Vancouver', city: 'Vancouver', state: 'CA' }, [
        card('e', 'Monte Clark Gallery', 'Art gallery'),
        card('f', 'Vancouver WA Art Gallery', 'Art gallery'),
    ], {
        e: { name: 'Monte Clark Gallery', address: '525 Great Northern Way, Vancouver, BC V5T 1E1', category: 'Art gallery', phone: '+16047305000', rating: 4.5, reviews: 30 },
        f: { name: 'Vancouver WA Art Gallery', address: '1000 Main St, Vancouver, WA 98660, United States', category: 'Art gallery', phone: '+13605550100', rating: 4.2, reviews: 10 },
    });
    assert.deepEqual(vancouver.allLeads.map(l => l.business_name), ['Monte Clark Gallery']);
    assert.ok(vancouver.logs.some(m => /Outside Worldwide: Vancouver WA Art Gallery/.test(m)));
    const [monte] = vancouver.allLeads;
    assert.equal(monte.city, 'Vancouver');
    assert.equal(monte.bundesland, 'BC');
    assert.equal(monte.country_name, 'Canada');

    const dubai = await run({ text: 'Art gallery Dubai', city: 'Dubai', state: 'AE' }, [card('g', 'Green Art Gallery', 'Art gallery')], {
        g: { name: 'Green Art Gallery', address: 'Alserkal Avenue - Street 8 - Al Quoz - Al Quoz Industrial Area 1 - Dubai - United Arab Emirates', category: 'Art gallery', phone: '+97143469305', rating: 4.8, reviews: 50 },
    });
    const [green] = dubai.allLeads;
    assert.equal(green.city, 'Dubai');
    assert.equal(green.bundesland, 'Dubai');
    assert.equal(green.country_name, 'United Arab Emirates');

    // A Paris row has no region rather than the country code.
    const paris = await run({ text: 'Art gallery Paris', city: 'Paris', state: 'FR' }, [card('h', 'Galerie Templon', 'Art gallery')], {
        h: { name: 'Galerie Templon', address: '30 Rue Beaubourg, 75003 Paris', category: 'Art gallery', phone: '+33142721410', rating: 4.5, reviews: 90 },
    });
    assert.equal(paris.allLeads[0].bundesland, '');
    assert.equal(paris.allLeads[0].country_name, 'France');

    const all = [...sydney.allLeads, ...vancouver.allLeads, ...dubai.allLeads, ...paris.allLeads];
    for (const lead of all) {
        assert.equal(lead.campaign, 'art');
        assertContract(lead);
    }
    // leads.json keeps the contract on every row.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-art-'));
    await createSaver(dir, { template: loadTemplate(WORLD.emailTemplate), whatsappTemplate: loadWhatsAppTemplate(WORLD.whatsappTemplate), includeTiers: WORLD.includeTiers,
        workbook: WORLD.workbook, columns: WORLD.columns, log: () => {} })(all);
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'leads.json'), 'utf8'));
    assert.equal(json.length, 5);
    for (const r of json) {
        for (const k of ['business_name', 'website', 'maps_url', 'city', 'bundesland', 'country_name', 'address', 'phone', 'email', 'instagram_url', 'contact_name', 'contact_role',
            'category', 'maps_description', 'rating', 'review_count', 'observed_date', 'campaign', 'relevance_tier', 'art_type', 'accepts_submissions', 'accepts_consignments',
            'submission_url', 'consign_url', 'specialties']) assert.ok(k in r, `${r.business_name}: ${k}`);
        assertContract(r);
    }
    assert.deepEqual(json.map(r => r.country_name).sort(), ['Australia', 'Australia', 'Canada', 'France', 'United Arab Emirates']);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('world art: the English art templates, with nothing US-only in them', () => {
    const US_ART = resolveCountry({ country: 'US', campaign: 'art' });
    assert.equal(WORLD.emailTemplate, US_ART.emailTemplate);
    const t = loadTemplate(WORLD.emailTemplate);
    const e = renderEmail({ business_name: 'Galerie Templon' }, t);
    assert.match(e.body, /If you would rather not hear from us again/);
    assert.match(e.body, /\[Postal address\]\n$/);
    assert.doesNotMatch(e.subject + e.body, /CAN-SPAM|United States|\bUS\b|America/);
    assert.doesNotMatch(loadWhatsAppTemplate(WORLD.whatsappTemplate), /United States|\bUS\b|America/);
});

test('world art: galleries, auction houses and dealers named in Hungarian, Polish, Czech, Greek, Turkish, Romanian, Arabic, Thai, Indonesian, Vietnamese and Cyrillic', () => {
    for (const [name, category, tier] of [
        ['Virág Judit Galéria', '', 'Gallery'],
        ['Kálmán Makláry Fine Arts Galéria', 'Art gallery', 'Gallery'],
        ['Kieselbach Galéria és Aukciósház', '', 'Auction house'],
        ['BÁV Aukciósház', '', 'Auction house'],
        ['Darabanth Árverezőház', '', 'Auction house'],
        ['Pintér Műkereskedés', '', 'Art dealer'],
        ['Galeria Raster', '', 'Gallery'],
        ['Desa Unicum Dom Aukcyjny', '', 'Auction house'],
        ['Agra-Art Aukcja', '', 'Auction house'],
        ['Antykwariat Sztuki Rara Avis', 'Store', 'Art dealer'],
        ['Galerie Zdeněk Sklenář', '', 'Gallery'],
        ['Aukční síň Galerie Kodl', '', 'Auction house'],
        ['European Arts Aukce', '', 'Auction house'],
        ['Starožitnosti a umění Ungelt', 'Antique store', 'Art dealer'],
        ['Γκαλερί Ζουμπουλάκη', '', 'Gallery'],
        ['Οίκος Δημοπρασιών Βέργος', '', 'Auction house'],
        ['ΔΗΜΟΠΡΑΣΙΕΣ ΒΕΡΓΟΣ', '', 'Auction house'],
        ['Pi Artworks Sanat Galerisi', '', 'Gallery'],
        ['Galeri Nev', '', 'Gallery'],
        ['Antik A.Ş. Müzayede Evi', '', 'Auction house'],
        ['Portakal Mezat', '', 'Auction house'],
        ['Galeria Anaid', '', 'Gallery'],
        ['Galerie de Artă Quadro', '', 'Gallery'],
        ['Artmark Casă de Licitații', '', 'Auction house'],
        ['غاليري أثر', '', 'Gallery'],
        ['معرض فني الرياض', '', 'Gallery'],
        ['دار مزادات الكويت', '', 'Auction house'],
        ['แกลเลอรี่ VER', '', 'Gallery'],
        ['บ้านประมูล', '', 'Auction house'],
        ['Galeri Seni Rumah', '', 'Gallery'],
        ['Balai Lelang Masterpiece', '', 'Auction house'],
        ['Phòng Tranh Thanh Lễ', '', 'Gallery'],
        ['Nhà Đấu Giá Chọn', '', 'Auction house'],
        ['Галерия Арте', '', 'Gallery'],
        ['Аукционна къща Ракурси', '', 'Auction house'],
        ['Галерија Х', '', 'Gallery'],
        ['Аукціонний дім Гоголь', '', 'Auction house'],
        ['Galerija Kos', '', 'Gallery'],
        ['Galerija Vartai', '', 'Gallery'],
        ['Galerii Kuus', '', 'Gallery'],
        ['Doradztwo artystyczne Kowalska', 'Consultant', 'Art advisor'],
        ['Sanat Danışmanlığı Ayşe', 'Consultant', 'Art advisor'],
        // A Turkish "galeri" can be a used-car lot; a hotel called "Art" is a hotel ("فن" is not "فندق").
        ['Galeri Mavi Oto', 'Used car dealer', 'Not a buyer'],
        ['فندق الفن', 'Hotel', 'Not a buyer'],
    ]) assert.equal(tierOf(place(name, category, { country: 'HU' })), tier, name);
});

test('world art: framing, tattoo and classes in the new languages are not buyers; their museums, foundations and public galleries are non-profits', () => {
    for (const [name, category, provisional] of [
        ['Képkeretezés Budapest', 'Store', false],
        ['Ramiarnia Kraków', 'Store', false],
        ['Rámování obrazů', 'Store', false],
        ['Çerçeveci Ahmet', 'Store', false],
        ['Κορνίζες Παπαδόπουλος', 'Store', false],
        ['Toko Pigura Jaya', 'Store', false],
        ['Khung Tranh Đẹp', 'Store', false],
        ['محل براويز', 'Store', false],
        ['ร้านกรอบรูป', 'Store', false],
        ['Galéria & Képkeretezés', 'Art gallery', true],
        ['Tetoválás Stúdió', 'Art gallery', false],
        ['Dövme Atölyesi', 'Art gallery', false],
        ['Sanat Atölyesi Kids', 'Art gallery', false],
    ]) {
        const r = scoreRelevance(place(name, category));
        assert.equal(r.tier, 'Not a buyer', name);
        assert.equal(r.provisional, provisional, `${name}: provisional`);
    }
    // A framer that shows exhibitions on its site is a gallery, in Hungarian too.
    assert.equal(tierOf(place('Galéria & Képkeretezés', 'Art gallery'), 'Aktuális kiállítás: Kovács Anna. A galéria művészei.'), 'Gallery');
    for (const name of ['Magyar Nemzeti Galéria', 'Ludwig Múzeum', 'Műcsarnok', 'Zachęta Narodowa Galeria Sztuki', 'Galeria Miejska Arsenał', 'Galeria BWA Katowice',
        'Fundacja Galerii Foksal', 'Národní galerie Praha', 'Moravská galerie', 'Slovenská národná galéria', 'Moderna galerija', 'Muzej suvremene umjetnosti', 'Kiasma taidemuseo',
        'Kumu kunstimuuseum', 'Εθνική Πινακοθήκη', 'Μουσείο Μπενάκη', 'Ίδρυμα Ωνάση', 'İstanbul Modern Sanat Müzesi', 'Arter Vehbi Koç Vakfı', 'Muzeul Național de Artă',
        'Fundația Calina', 'Національний художній музей України', 'متحف الفن الإسلامي', 'هيئة الفنون البصرية', 'พิพิธภัณฑ์ศิลปะ', 'Galeri Nasional Indonesia',
        'Yayasan Seni Cemeti', 'Bảo tàng Mỹ thuật']) {
        const lead = place(name, 'Art gallery');
        assert.equal(isSellable(lead).ok, false, name);
        assert.equal(tierOf(lead), 'Non-profit / museum', name);
    }
    // A gallery on Budapest's Múzeum körút is not a museum.
    assert.equal(tierOf(place('Galéria a Múzeum körúton', 'Art gallery')), 'Gallery');
    for (const site of ['A galéria közhasznú egyesület.', 'Fundacja jest organizacją pożytku publicznego.', 'Galerie je nezisková organizace.', 'Kâr amacı gütmeyen bir kuruluş.']) {
        assert.equal(tierOf(place('Galéria X', 'Art gallery', { maps_description: site })), 'Non-profit / museum', site);
    }
});

test('world art: exhibitions, consignments and contemporary art on sites in the new languages; museum names do not count; their contact pages are read', () => {
    // A bare name: the site decides.
    for (const site of ['Aktuális kiállítás: X. A galéria művészei.', 'Aktualne wystawy. Nasi artyści.', 'Aktuální výstavy. Umělci galerie.', 'Güncel sergiler. Sanatçılarımız.',
        'Τρέχουσα έκθεση. Οι καλλιτέχνες μας.', 'Expoziții curente. Artiștii galeriei.', 'المعارض الحالية', 'Pameran saat ini. Seniman kami.', 'Triển lãm hiện tại.',
        'Поточні виставки. Наші художники.']) assert.equal(tierOf(place('Sammlung Weber', ''), site), 'Gallery', site);
    for (const site of ['Vásárolunk festményeket és műtárgyakat.', 'Skup obrazów i dzieł sztuki.', 'Bezplatný odhad. Výkup obrazů.'])
        assert.equal(tierOf(place('Sammlung Weber', ''), site), 'Art dealer', site);

    const consign = (site) => fieldsOf(place('Galéria X', 'Art gallery'), site).accepts_consignments;
    for (const site of ['Ingyenes értékbecslés, bizományi értékesítés.', 'Bezpłatna wycena dzieł sztuki.', 'Przyjmujemy obiekty na aukcje.', 'Komisní prodej obrazů.',
        'Müzayedeye eser kabulü devam ediyor.', 'Δωρεάν εκτίμηση έργων.', 'Evaluare gratuită.']) assert.equal(consign(site), 'yes', site);
    assert.equal(consign('Aktuális kiállítás. Nyitvatartás.'), 'unknown');

    const spec = (site) => fieldsOf(place('Galéria X', 'Art gallery'), site).specialties;
    for (const site of ['Kortárs művészet.', 'Sztuka współczesna.', 'Současné umění.', 'Súčasné umenie.', 'Suvremena umjetnost.', 'Çağdaş sanat.', 'Σύγχρονη τέχνη.',
        'Artă contemporană.', 'الفن المعاصر', 'ศิลปะร่วมสมัย', 'Seni kontemporer.', 'Nghệ thuật đương đại.', 'Сучасне мистецтво.', 'Съвременно изкуство.']) {
        assert.equal(spec(site), 'contemporary', site);
    }
    for (const site of ['A Ludwig Múzeum – Kortárs Művészeti Múzeum mellett.', 'Obok Muzeum Sztuki Współczesnej i Centrum Sztuki Współczesnej.',
        'İstanbul Modern Çağdaş Sanat Müzesi yakınında.', 'Δίπλα στο Μουσείο Σύγχρονης Τέχνης.', 'Lângă Muzeul Național de Artă Contemporană.']) assert.equal(spec(site), '', site);

    // Consign pages, which are never submission pages.
    for (const [p, t] of [['/ertekbecsles', 'Értékbecslés'], ['/bizomany', ''], ['/wycena', 'Wycena'], ['/skup-obrazow', ''], ['/odhad-ceny', ''], ['/vykup-obrazu', ''],
        ['/eser-kabul', 'Eser kabul'], ['/ekspertiz', '']]) {
        assert.ok(CONSIGN_LINK.test(`${p} ${t}`.trim()), `${p} ${t}`);
        assert.ok(!SUBMISSION_LINK.test(`${p} ${t}`.trim()), `${p} ${t}`);
    }
    // "skupina" (Czech: group) is not "skup".
    assert.ok(!CONSIGN_LINK.test('/skupina Skupina'));

    const links = findContactLinks('<a href="/kapcsolat">Kapcsolat</a><a href="/iletisim">İletişim</a><a href="/el/epikoinonia">Επικοινωνία</a><a href="/ua/kontakty">Контакти</a>'
        + '<a href="/ar/contact-us">اتصل بنا</a><a href="/th/c">ติดต่อเรา</a><a href="/hubungi-kami">Hubungi Kami</a><a href="/lien-he">Liên hệ</a><a href="/shop">Shop</a>', 'https://g.example/', { max: 10 });
    assert.deepEqual(links.sort(), ['https://g.example/ar/contact-us', 'https://g.example/el/epikoinonia', 'https://g.example/hubungi-kami', 'https://g.example/iletisim',
        'https://g.example/kapcsolat', 'https://g.example/lien-he', 'https://g.example/th/c', 'https://g.example/ua/kontakty']);
    assert.match(WORLD.contactKeyPage, /kapcsolat/);
    assert.ok(WORLD.contactPaths.includes('/kapcsolat') && WORLD.contactPaths.includes('/iletisim'));
});

test('world art feed: Budapest, Istanbul, Bangkok, Santiago and a Singapore search that finds Johor Bahru — City, region, Country, phone; Minsk and Moscow are dropped', async () => {
    const run = async (query, cards, details) => {
        let current = '';
        const calls = [];
        const page = {
            url: () => current || 'https://www.google.com/maps/search/x',
            goto: async (u) => { current = u; calls.push(u); },
            $: async (sel) => (sel === 'div[role="feed"]' || sel === 'h1.DUwDvf' ? {} : null),
            $$eval: async () => cards.length,
            waitForSelector: async () => {},
            bringToFront: async () => {},
            evaluate: async (fn, ...args) => {
                if (fn === extractFeedCards) return cards;
                if (fn === extractDetail) { calls.push(args); return details[current.match(/place\/(\w)/)[1]]; }
                return null;
            },
        };
        const allLeads = [];
        const logs = [];
        await scrapeQuery(page, query, { seen: new Set(), allLeads, log: (m) => logs.push(m) },
            { maxResultsPerQuery: 60, maxScrolls: 0, minReviews: 0, maxLeads: 100, delayBetweenListings: 0, keepNonProfits: false, country: WORLD });
        return { allLeads, calls, logs };
    };
    const card = (id, name, category) => ({ name, href: `https://www.google.com/maps/place/${id}/data=!1s0x1:0x${id}`, category, rating: 4.6, reviewCount: 70, closedFlag: false });

    const budapest = await run({ text: 'Art gallery Falk Miksa utca, Budapest', city: 'Falk Miksa utca, Budapest', state: 'HU' }, [
        card('a', 'Virág Judit Galéria', 'Art gallery'),
        card('b', 'Magyar Nemzeti Galéria', 'Art museum'),
        card('c', 'Képkeretezés Pest', 'Picture frame shop'),
        card('d', 'Kieselbach Galéria és Aukciósház', 'Auction house'),
    ], {
        a: { name: 'Virág Judit Galéria', address: 'Budapest, Falk Miksa u. 30, 1055', category: 'Art gallery', phone: '+3613122071', rating: 4.8, reviews: 120 },
        d: { name: 'Kieselbach Galéria és Aukciósház', address: 'Budapest, Szent István krt. 5, 1055', category: 'Auction house', phone: '+3612693148', rating: 4.7, reviews: 90 },
    });
    assert.match(budapest.calls[0], /\?hl=en&gl=hu$/);
    assert.deepEqual(budapest.calls.filter(Array.isArray)[0], ['36', ['06'], [8, 9]], 'the Hungarian phone code, trunk and lengths');
    assert.ok(budapest.logs.some(m => /non-profit:1 not-a-buyer:1/.test(m)));
    assert.deepEqual(budapest.allLeads.map(l => [l.business_name, l.city, l.bundesland, l.country_name, l.relevance_tier]), [
        ['Virág Judit Galéria', 'Budapest', '', 'Hungary', 'Gallery'],
        ['Kieselbach Galéria és Aukciósház', 'Budapest', '', 'Hungary', 'Auction house'],
    ]);

    const istanbul = await run({ text: 'Art gallery Karaköy, Istanbul', city: 'Karaköy, Istanbul', state: 'TR' }, [card('e', 'Pi Artworks Sanat Galerisi', 'Art gallery')], {
        e: { name: 'Pi Artworks Sanat Galerisi', address: 'Kemankeş Karamustafa Paşa, Kemankeş Cd. No:1, 34425 Beyoğlu/İstanbul', category: 'Art gallery', phone: '+902122931000', rating: 4.6, reviews: 40 },
    });
    assert.deepEqual(istanbul.allLeads.map(l => [l.city, l.bundesland, l.country_name, l.phone_code]), [['İstanbul', 'İstanbul', 'Türkiye', '90']]);

    const bangkok = await run({ text: 'Art gallery Bang Rak, Bangkok', city: 'Bang Rak, Bangkok', state: 'TH' }, [card('f', 'Bangkok CityCity Gallery', 'Art gallery')], {
        f: { name: 'Bangkok CityCity Gallery', address: '13/3 Sathon Tai Rd, Khwaeng Thung Maha Mek, Khet Sathon, Krung Thep Maha Nakhon 10120', category: 'Art gallery', phone: '+6620234567', rating: 4.6, reviews: 300 },
    });
    assert.deepEqual(bangkok.allLeads.map(l => [l.city, l.bundesland, l.country_name]), [['Bangkok', 'Bangkok', 'Thailand']]);

    const santiago = await run({ text: 'Art gallery Vitacura, Santiago', city: 'Vitacura, Santiago', state: 'CL' }, [card('g', 'Galería Patricia Ready', 'Art gallery')], {
        g: { name: 'Galería Patricia Ready', address: 'Espoz 3125, 7630000 Vitacura, Región Metropolitana', category: 'Art gallery', phone: '+56229536210', rating: 4.7, reviews: 200 },
    });
    assert.deepEqual(santiago.allLeads.map(l => [l.city, l.bundesland, l.country_name]), [['Santiago', 'Región Metropolitana', 'Chile']]);

    // A Singapore search finds Johor Bahru: Malaysia is in the run now, read as a Malaysian address.
    const singapore = await run({ text: 'Art gallery Singapore', city: 'Singapore', state: 'SG' }, [
        card('h', 'Johor Art Gallery', 'Art gallery'),
        card('i', 'Galeri Minsk', 'Art gallery'),
        card('j', 'Galereya Moskva', 'Art gallery'),
    ], {
        h: { name: 'Johor Art Gallery', address: 'Jalan Petrie, 80100 Johor Bahru, Johor, Malaysia', category: 'Art gallery', phone: '+6072241234', rating: 4.3, reviews: 30 },
        i: { name: 'Galeri Minsk', address: 'Praspiekt Niezaliežnasci 1, Minsk, Belarus', category: 'Art gallery', phone: '+375171234567', rating: 4.1, reviews: 10 },
        j: { name: 'Galereya Moskva', address: 'Tverskaya St, 1, Moskva, 125009, Russia', category: 'Art gallery', phone: '+74951234567', rating: 4.2, reviews: 10 },
    });
    assert.deepEqual(singapore.allLeads.map(l => [l.business_name, l.city, l.bundesland, l.country_name]), [['Johor Art Gallery', 'Johor Bahru', 'Johor', 'Malaysia']]);
    assert.ok(singapore.logs.some(m => /Outside Worldwide: Galeri Minsk/.test(m)));
    assert.ok(singapore.logs.some(m => /Outside Worldwide: Galereya Moskva/.test(m)));

    for (const lead of [...budapest.allLeads, ...istanbul.allLeads, ...bangkok.allLeads, ...santiago.allLeads, ...singapore.allLeads]) {
        assert.equal(lead.campaign, 'art');
        assertContract(lead);
    }
});

test('world art "places": cities by country code in one file, searched exactly as the full run searches them; its own folder and progress', () => {
    const warnings = [];
    const input = { country: 'WORLD', campaign: 'art', places: { HU: ['Budapest', 'Pécs'], pl: ['krakow'], RU: ['Moscow'], XX: ['Atlantis'] }, districts: true };
    const locs = resolveLocations(input, (m) => warnings.push(m));
    assert.deepEqual(locs.map(l => `${l.state} ${l.city}`), ['HU Budapest', 'HU Pécs', 'PL Kraków', 'HU District V, Budapest', 'HU Falk Miksa utca, Budapest',
        'HU District VI, Budapest', 'HU District VII, Budapest', 'PL Stare Miasto, Kraków', 'PL Kazimierz, Kraków']);
    // Russia (left out) and an unknown code are skipped with a warning.
    assert.equal(warnings.length, 2);
    assert.match(warnings.join('\n'), /"RU"[\s\S]*"XX"/);
    // Every known city comes out as the full run has it: same code, same string, so the same query text.
    const full = resolveLocations({ country: 'WORLD', campaign: 'art' }, () => {});
    for (const l of locs) assert.ok(full.some(f => f.state === l.state && f.city === l.city), `${l.state} ${l.city}`);
    const fullTexts = new Set(buildQueryMatrix(full, WORLD.categories, WORLD.highYield).map(q => `${q.state}|${q.text}`));
    for (const q of buildQueryMatrix(locs, WORLD.categories, WORLD.highYield)) assert.ok(fullTexts.has(`${q.state}|${q.text}`), q.text);
    // Varnish's own spelling: a country name after the city, no accents, "GB"; a city the run doesn't know is searched as given.
    assert.deepEqual(resolveLocations({ country: 'WORLD', campaign: 'art', places: { HU: ['Budapest, Hungary', 'Sopron'], GB: ['london'], PL: ['Lodz'] }, districts: false }, () => {})
        .map(l => `${l.state} ${l.city}`), ['HU Budapest', 'HU Sopron', 'UK London', 'PL Łódź']);
    // "places" wins over "states" and "cities".
    assert.deepEqual(resolveLocations({ country: 'WORLD', campaign: 'art', states: ['JP'], cities: ['Tokyo'], places: { CZ: ['Prague'] }, districts: false }, () => {}),
        [{ state: 'CZ', city: 'Prague' }]);
    // Each search runs as that code's market.
    assert.equal(WORLD.markets[locs[2].state].gl, 'pl');

    // Its own folder: a "places" run without "outputDir" never writes into the full run's.
    assert.equal(resolveOutputDir(input), 'output-world-art-places');
    assert.equal(resolveOutputDir({ ...input, outputDir: 'output-varnish-budapest' }), 'output-varnish-budapest');
    assert.equal(resolveOutputDir({ country: 'WORLD', campaign: 'art' }), 'output-world-art');
    // …and progress.json is trusted only by the same searches, not just the same number of them.
    const qa = buildQueryMatrix(resolveLocations({ country: 'WORLD', campaign: 'art', places: { HU: ['Budapest'] }, districts: false }, () => {}), WORLD.categories, WORLD.highYield);
    const qb = buildQueryMatrix(resolveLocations({ country: 'WORLD', campaign: 'art', places: { PL: ['Kraków'] }, districts: false }, () => {}), WORLD.categories, WORLD.highYield);
    assert.equal(qa.length, qb.length);
    const progress = { country: runKey(WORLD), queries: qa.length, fingerprint: queryFingerprint(qa), next: qa.length };
    assert.equal(resumePoint(qa, [], progress, runKey(WORLD)), qa.length, 'the same run: finished');
    assert.equal(resumePoint(qb, [], progress, runKey(WORLD)), 0, 'another run with as many queries starts at the beginning');
});
