import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import { resolveCountry, resolveLocations, buildQueryMatrix } from '../src/config.js';
import { mapsSearchUrl, cityFromAddress, stateFromAddress, pickCity } from '../src/maps.js';
import { extractDetail } from '../src/dom-extract.js';
import { extractWhatsApp, classifyWhatsApp, normaliseNumber, WA, loadWhatsAppTemplate } from '../src/whatsapp.js';
import { scoreRelevance, isSellable, isPublicBody, isTarget } from '../src/relevance.js';
import { rankEmails } from '../src/contacts.js';
import { prepareLeads } from '../src/output.js';

test('the US is its own market: NY, NJ and FL, each city with its state', () => {
    for (const name of ['US', 'USA', 'United States', 'america']) assert.equal(resolveCountry({ country: name }).code, 'US');
    const us = resolveCountry({ country: 'US' });
    assert.equal(us.outputDir, 'output-us');
    assert.equal(us.phoneCode, '1');
    assert.equal(us.script, 'us');
    const locs = resolveLocations({ country: 'US', states: ['NY', 'NJ', 'FL'] }, () => {});
    for (const city of ['Borough Park, Brooklyn, NY', 'Lakewood, NJ', 'Teaneck, NJ', 'Monsey, NY', 'Kew Gardens Hills, Queens, NY', 'Miami Beach, FL', 'Boca Raton, FL']) {
        assert.ok(locs.some(l => l.city === city), city);
    }
    // "Lawrence" alone is in Kansas; the state keeps the search in the Five Towns.
    assert.ok(locs.every(l => /, (NY|NJ|FL)$/.test(l.city)));
    const q = buildQueryMatrix(locs, us.categories, us.highYield);
    assert.equal(q[0].text, 'Judaica Manhattan, NY');
    assert.equal(mapsSearchUrl('Judaica Lakewood, NJ', us.gl), 'https://www.google.com/maps/search/Judaica%20Lakewood%2C%20NJ?hl=en&gl=us');
});

test('US addresses: the town and state come from the address', () => {
    const us = resolveCountry({ country: 'US' });
    assert.equal(cityFromAddress('4920 13th Ave, Brooklyn, NY 11219', 'US'), 'Brooklyn');
    assert.equal(cityFromAddress('1 Main St Suite 2, Lakewood, NJ 08701, United States', 'US'), 'Lakewood');
    assert.equal(stateFromAddress('9580 Harding Ave, Surfside, FL 33154'), 'FL');
    assert.equal(stateFromAddress('Fasanenstraße 79, 10623 Berlin'), '');
    // A Teaneck search that returns a Monsey shop says Monsey.
    assert.equal(pickCity('58 NY-59, Monsey, NY 10952', 'Teaneck, NJ', us), 'Monsey');
    // No address: the searched town, without its district or state.
    assert.equal(pickCity('', 'Borough Park, Brooklyn, NY', us), 'Brooklyn');
    assert.equal(pickCity('', 'Lakewood, NJ', us), 'Lakewood');
    assert.ok(us.foreign.test('100 Queen St W, Toronto, ON M5H 2N2, Canada'));
    assert.ok(us.foreign.test('5800 Boulevard Cavendish, Côte Saint-Luc, QC H4W 2T5'));
    assert.ok(!us.foreign.test('4920 13th Ave, Brooklyn, NY 11219'));
});

test('US phones become +1; their WhatsApp status is never guessed', () => {
    const read = (tel) => {
        const dom = new JSDOM(`<div role="main"><h1 class="DUwDvf">X</h1><button data-item-id="phone:tel:${tel}"></button></div>`,
            { url: 'https://www.google.com/maps/place/x' });
        const prev = global.document;
        global.document = dom.window.document;
        try { return extractDetail('1').phone; } finally { global.document = prev; }
    };
    assert.equal(read('(718) 555-1234'), '+17185551234');
    assert.equal(read('+1 718-555-1234'), '+17185551234');
    assert.equal(read('1-732-555-0100'), '+17325550100');
    assert.equal(read('+972 3-555-1234'), '+97235551234', 'an Israeli number is not rewritten');

    assert.equal(normaliseNumber('(718) 555-1234', '1'), '+17185551234');
    assert.deepEqual(extractWhatsApp('<p>Orders on WhatsApp: (718) 555-1234</p>', '1').numbers, ['+17185551234']);
    assert.deepEqual(extractWhatsApp('<a href="https://wa.me/17325550100">Chat</a>', '1').numbers, ['+17325550100']);

    // +1 mobiles and landlines share area codes: neither "mobile" nor "landline".
    const unknown = classifyWhatsApp({ phone: '+17185551234' });
    assert.equal(unknown.status, WA.UNKNOWN);
    assert.equal(unknown.priority, 3);
    assert.equal(classifyWhatsApp({ phone: '+17185551234', whatsapp_site_linked: true }).status, WA.LINK_SITE);
    assert.equal(classifyWhatsApp({ phone: '+17185551234', whatsapp_mentioned: true }).status, WA.MENTIONED);
    assert.equal(classifyWhatsApp({ phone: '+447958131295' }).status, WA.MOBILE, 'other countries unchanged');
});

test('US Judaica stores, seforim stores and kosher groceries are targets', () => {
    assert.equal(scoreRelevance({ business_name: "Eichler's Judaica", category: 'Judaica store' }).tier, 'Judaica seller');
    assert.equal(scoreRelevance({ business_name: 'Seforim Center', category: 'Book store' }).tier, 'Judaica seller');
    assert.equal(scoreRelevance({ business_name: 'Z. Berman Books', category: 'Book store' }, 'seforim, tallis bags, mezuzah cases, kiddush cups').tier, 'Judaica seller');
    assert.equal(scoreRelevance({ business_name: 'Pomegranate', category: 'Kosher grocery store' }).tier, 'Jewish / Israeli retail');
    assert.equal(scoreRelevance({ business_name: 'Gourmet Glatt', category: 'Supermarket' }).tier, 'Jewish / Israeli retail');
    assert.ok(!isTarget(scoreRelevance({ business_name: 'Kosher Pizza Plus', category: 'Pizza restaurant' })));
});

test('US synagogues, their gift shops, charities and government are not buyers', () => {
    for (const [business_name, category] of [
        ['Congregation Shaare Zion', 'Synagogue'],
        ['Young Israel of Flatbush', 'Synagogue'],
        ['Temple Beth El Gift Shop', 'Gift shop'],
        ['Temple Emanu-El Judaica Shop', 'Judaica store'],
        ['Sisterhood Gift Shop of Congregation Beth Israel', 'Gift shop'],
        ['Hadassah Thrift Shop', 'Thrift store'],
        ['Jewish Community Center of Manhattan', 'Community center'],
    ]) assert.equal(isSellable({ business_name, category }).ok, false, business_name);
    // A Chabad-run store and a shop on the Paris Rue du Temple still are.
    assert.equal(isSellable({ business_name: 'Chabad Judaica Store', category: 'Judaica store' }).ok, true);
    assert.equal(isSellable({ business_name: 'Boutique du Temple', category: 'Gift shop' }).ok, true);
    assert.equal(isPublicBody({ business_name: 'Miami Beach Visitor Center Shop', website: 'https://www.miamibeachfl.gov/shop' }), true);
    assert.equal(isPublicBody({ business_name: 'X', website: 'https://www.ci.boca-raton.fl.us/' }), true);
    assert.equal(isPublicBody({ business_name: "Eichler's", website: 'https://www.eichlers.com/' }), false);
});

test('US inboxes: Optimum and Verizon addresses are a shop\'s own', () => {
    const ranked = rankEmails(['webmaster@nycwebdesign.com', 'judaicashop@optonline.net'], 'https://www.facebook.com/judaicashop', 'Judaica Shop');
    assert.equal(ranked[0], 'judaicashop@optonline.net');
});

test('the US email and WhatsApp message say the collection is coming to the US', () => {
    const us = resolveCountry({ country: 'US' });
    assert.match(fs.readFileSync(us.emailTemplate, 'utf8'), /introducing our collection to the United States/);
    const wa = loadWhatsAppTemplate(us.whatsappTemplate);
    assert.match(wa, /United States/);
    const [row] = prepareLeads([{ business_name: "Eichler's Judaica", relevance_tier: 'Judaica seller', phone: '+17188510303' }], { whatsappTemplate: wa });
    assert.match(row.whatsapp_link, /^https:\/\/wa\.me\/17188510303\?text=.*United%20States/);
    // Other markets keep the original wording.
    assert.equal(resolveCountry({ country: 'DE' }).emailTemplate, undefined);
});
