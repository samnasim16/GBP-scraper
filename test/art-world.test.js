import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { resolveCountry, resolveLocations, buildQueryMatrix } from '../src/config.js';
import { WORLD_MARKETS } from '../src/world.js';
import { marketOfAddress } from '../src/europe.js';
import { scoreRelevance, isSellable, isPublicBody } from '../src/relevance.js';
import { SPECIALTIES, SUBMISSION_LINK, CONSIGN_LINK } from '../src/art.js';
import { findContactLinks } from '../src/contacts.js';
import { relevanceFields, scrapeQuery, pickCity, cityFromAddress, regionFromAddress } from '../src/maps.js';
import { extractFeedCards, extractDetail } from '../src/dom-extract.js';
import { isMobile, classifyWhatsApp, fixMissingCode, WA, loadWhatsAppTemplate } from '../src/whatsapp.js';
import { loadTemplate, renderEmail } from '../src/email-template.js';
import { createSaver } from '../src/output.js';
import { runKey, resumePoint } from '../src/resume.js';

const WORLD = resolveCountry({ country: 'WORLD', campaign: 'art' });
const COUNTRIES_30 = ['UK', 'FR', 'DE', 'CH', 'IT', 'ES', 'NL', 'BE', 'AT', 'SE', 'DK', 'NO', 'IE', 'PT', 'MC', 'HK', 'SG', 'JP', 'KR', 'TW', 'IN', 'AE', 'AU', 'NZ', 'CA', 'MX', 'BR', 'AR', 'CO', 'ZA'];
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

test('world art: 30 countries, ~90 art cities, gallery districts, one run that never resumes another', () => {
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

    assert.deepEqual(Object.keys(WORLD.regions), COUNTRIES_30);
    for (const code of COUNTRIES_30) {
        const m = WORLD_MARKETS[code];
        assert.ok(m && m.gl && m.phoneCode && m.name, code);
        assert.ok(WORLD.regions[code].length > 0, code);
    }
    // The US and Israel have their own runs; mainland China is left out.
    for (const code of ['US', 'IL', 'CN']) assert.ok(!WORLD_MARKETS[code] && !WORLD.regions[code], code);
    // Country names are English, for country_name.
    assert.deepEqual(['UK', 'KR', 'AE', 'MX', 'BR', 'HK'].map(c => WORLD_MARKETS[c].name), ['United Kingdom', 'South Korea', 'United Arab Emirates', 'Mexico', 'Brazil', 'Hong Kong']);

    const cities = Object.values(WORLD.regions).flat();
    assert.ok(cities.length >= 80 && cities.length <= 100, `${cities.length} cities`);
    for (const city of ['London', 'Paris', 'Berlin', 'Basel', 'Geneva', 'Zurich', 'Maastricht', 'Venice', 'Milan', 'Brussels', 'Antwerp', 'Madrid', 'Barcelona', 'Lisbon',
        'Copenhagen', 'Stockholm', 'Vienna', 'Munich', 'Düsseldorf', 'Cologne', 'Monaco', 'Hong Kong', 'Singapore', 'Tokyo', 'Seoul', 'Taipei', 'Dubai', 'Abu Dhabi', 'Mumbai',
        'New Delhi', 'Sydney', 'Melbourne', 'Auckland', 'Toronto', 'Vancouver', 'Montreal', 'Mexico City', 'São Paulo', 'Buenos Aires', 'Bogotá', 'Cape Town', 'Johannesburg']) {
        assert.ok(cities.includes(city), city);
    }
    const locs = resolveLocations({ country: 'WORLD', campaign: 'art' }, () => {});
    for (const [city, state] of [['Mayfair, London', 'UK'], ["St James's, London", 'UK'], ['Shoreditch, London', 'UK'], ['Fitzrovia, London', 'UK'], ['Le Marais, Paris', 'FR'],
        ['Saint-Germain-des-Prés, Paris', 'FR'], ['Avenue Matignon, Paris', 'FR'], ['Mitte, Berlin', 'DE'], ['Kreuzberg, Berlin', 'DE'], ['Charlottenburg, Berlin', 'DE'],
        ['Central, Hong Kong', 'HK'], ['Wong Chuk Hang, Hong Kong', 'HK'], ['Ginza, Tokyo', 'JP'], ['Roppongi, Tokyo', 'JP'], ['Samcheong-dong, Seoul', 'KR'],
        ['Hannam-dong, Seoul', 'KR'], ['Roma Norte, Mexico City', 'MX'], ['Polanco, Mexico City', 'MX'], ['Jardins, São Paulo', 'BR']]) {
        assert.ok(locs.some(l => l.city === city && l.state === state), city);
    }
    // Every search runs as a country (never a bare "cities" list).
    assert.ok(locs.every(l => WORLD_MARKETS[l.state]));
    const q = buildQueryMatrix(locs, WORLD.categories, WORLD.highYield);
    assert.ok(q.slice(0, locs.length).every(x => x.category === 'Art gallery'));
    assert.equal(q[0].text, 'Art gallery London');
    assert.deepEqual([...new Set(resolveLocations({ country: 'WORLD', campaign: 'art', states: ['jp', 'BR'] }, () => {}).map(l => l.state))], ['JP', 'BR']);
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
    ]) assert.equal(read(tel, code), phone, `${code} ${tel}`);

    // WhatsApp: mobiles in the new markets are "Likely", landlines "Check", +1 is unknowable.
    for (const n of ['+85291234567', '+6591234567', '+819012345678', '+821012345678', '+886912345678', '+919820012345', '+971501234567', '+61412345678',
        '+64211234567', '+5511987654321', '+5491141234567', '+573101234567', '+27821234567', '+393331234567', '+34612345678', '+351912345678', '+46701234567',
        '+4791234567', '+353861234567', '+377612345678']) assert.ok(isMobile(n), n);
    for (const n of ['+85225231234', '+6561234567', '+81312345678', '+82212345678', '+97141234567', '+61291234567', '+551130611234', '+576012345678', '+27211234567', '+390212345678'])
        assert.ok(!isMobile(n), n);
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

    // The Country column, and results outside the run.
    assert.equal(marketOfAddress('Alserkal Avenue - Al Quoz - Dubai - United Arab Emirates', WORLD_MARKETS), 'AE');
    assert.equal(marketOfAddress('6 Chome-10-1 Roppongi, Minato City, Tokyo 106-6108, Japan', WORLD_MARKETS), 'JP');
    assert.equal(marketOfAddress('Seoul, South Korea', WORLD_MARKETS), 'KR');
    assert.equal(marketOfAddress('Colima 196, 06700 Ciudad de México, CDMX, México', WORLD_MARKETS), 'MX');
    assert.equal(marketOfAddress('Hauptstraße 1, 79576 Weil am Rhein, Germany', WORLD_MARKETS), 'DE');
    for (const a of ['1000 Main St, Vancouver, WA 98660, United States', 'Av. da Praia Grande, Macau', 'Futian District, Shenzhen, Guangdong, China',
        'Jalan Wong Ah Fook, 80000 Johor Bahru, Johor, Malaysia', 'Gordon St 3, Tel Aviv-Yafo, Israel', 'Riyadh - Saudi Arabia']) assert.ok(WORLD.foreign.test(a), a);
    // "Hong Kong SAR, China" is Hong Kong, and keeps its town.
    assert.ok(!WORLD.foreign.test('G/F, 50 Connaught Rd Central, Central, Hong Kong SAR, China'));
    assert.equal(cityFromAddress('G/F, 50 Connaught Rd Central, Central, Hong Kong SAR, China', 'HK'), 'Hong Kong');
    assert.throws(() => resolveCountry({ country: 'JP', campaign: 'art' }), /"country": "WORLD", "states": \["JP"\]/);
    for (const a of ['Hauptstraße 1, 79576 Weil am Rhein, Germany', '68300 Saint-Louis, France', 'Stortorget 1, 211 22 Malmö, Sweden', 'Colima 196, 06700 Ciudad de México, CDMX',
        'R. Oscar Freire, 379 - Jardins, São Paulo - SP, 01426-001', 'Kala Ghoda, Fort, Mumbai, Maharashtra 400001', '2 Danks St, Waterloo NSW 2017']) assert.ok(!WORLD.foreign.test(a), a);
    // Public bodies beyond Europe and the US.
    for (const w of ['https://www.nga.gov.au/', 'https://www.mmca.go.kr/', 'https://www.tokyo.lg.jp/', 'https://www.inba.gob.mx/', 'https://www.art.edu.au/', 'https://www.bak.admin.ch/'])
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
