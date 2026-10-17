import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { JSDOM } from 'jsdom';

import { resolveCountry, resolveLocations, buildQueryMatrix } from '../src/config.js';
import { mapsSearchUrl, cityFromAddress, stateFromAddress, pickCity } from '../src/maps.js';
import { extractDetail } from '../src/dom-extract.js';
import { extractWhatsApp, classifyWhatsApp, normaliseNumber, WA, loadWhatsAppTemplate } from '../src/whatsapp.js';
import { scoreRelevance, isSellable, isPublicBody, isTarget } from '../src/relevance.js';
import { rankEmails, ContactEnricher, ownWebsite, looksLikeAppShell, extractEmails, extractContact, pickEmail, isThirdPartyEmail } from '../src/contacts.js';
import { createHttpClient } from '../src/http.js';
import { createBrowserFactory, resolveChromePath } from '../src/browser.js';
import { prepareLeads } from '../src/output.js';

/** isTarget reads a lead's relevance_tier; scoreRelevance returns { tier }. */
const targetOf = (lead, siteText = '') => isTarget({ relevance_tier: scoreRelevance(lead, siteText).tier });

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
    assert.ok(!targetOf({ business_name: 'Kosher Pizza Plus', category: 'Pizza restaurant' }));
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

/** A fake website: path → HTML; anything else is a 404. Records what was fetched. */
function fakeHttp(pages, redirects = {}) {
    const fetched = [];
    return {
        fetched,
        async fetchText(url) {
            fetched.push(url);
            const u = new URL(url);
            const to = redirects[u.origin + u.pathname];
            const at = to ? new URL(to) : u;
            const body = pages[at.origin + at.pathname];
            return body ? { ok: true, status: 200, body, url: at.toString() } : { ok: false, status: 404, body: '', url: at.toString() };
        },
    };
}

const US_CONTACTS = () => {
    const us = resolveCountry({ country: 'US' });
    return { phoneCode: us.phoneCode, keyPage: us.contactKeyPage, guessPaths: us.contactPaths, delayMs: 0, concurrency: 1 };
};

test('smoke run: a Maps link to a branch page still finds the shop\'s email', async () => {
    // Eichlers' listing gave no email in the run; its homepage → contact page has info@.
    const http = fakeHttp({
        'https://www.eichlers.com/': '<a href="/pages/contact-us">Contact Us</a><p>Judaica, menorahs, mezuzahs</p>',
        'https://www.eichlers.com/pages/contact-us': '<p>Email us: info@eichlers.com · returns@eichlers.com</p>',
    });
    const lead = { business_name: 'Eichlers Judaica', website: 'https://www.eichlers.com/pages/brooklyn-store?utm_source=gmb' };
    await new ContactEnricher({ http, config: US_CONTACTS(), log: () => {} }).enrich(lead);
    assert.equal(lead.email, 'info@eichlers.com');

    // A homepage with tracking codes and no contact link: the guessed /contact-us page.
    const http2 = fakeHttp({
        'https://keterjudaica.com/': '<p>Keter Judaica — Borough Park</p>',
        'https://keterjudaica.com/contact-us': '<p>keterjudaica@gmail.com</p>',
    });
    const keter = { business_name: 'Keter Judaica', website: 'https://keterjudaica.com/?utm_source=google&utm_medium=organic' };
    await new ContactEnricher({ http: http2, config: US_CONTACTS(), log: () => {} }).enrich(keter);
    assert.equal(keter.email, 'keterjudaica@gmail.com');
});

test('the homepage fallback never reaches an umbrella organisation\'s homepage', async () => {
    const http = fakeHttp({
        'https://www.chabadflatbush.org/': '<p>info@chabadflatbush.org</p>',
        'https://www.chabadflatbush.org/templates/articlecco_cdo/aid/123': '<p>Kosher King — a store in our community</p>',
    });
    const lead = { business_name: 'Kosher King', website: 'https://www.chabadflatbush.org/templates/articlecco_cdo/aid/123' };
    await new ContactEnricher({ http, config: US_CONTACTS(), log: () => {} }).enrich(lead);
    assert.ok(!http.fetched.includes('https://www.chabadflatbush.org/'), 'the umbrella homepage is not fetched');
    assert.equal(ownWebsite('https://www.eichlers.com/pages/brooklyn', 'Eichlers Judaica'), true);
    assert.equal(ownWebsite('https://shop.com/', 'Anything'), true);
    assert.equal(ownWebsite('https://www.chabadflatbush.org/aid/123', 'Kosher King'), false);
});

test('smoke run: Maps lists 1800eichlers.com, which redirects to eichlers.com', async () => {
    // The homepage links its contact page on the domain it redirected to.
    const http = fakeHttp({
        'https://www.eichlers.com/': '<a href="https://www.eichlers.com/pages/contact-us">Contact</a><p>Judaica</p>',
        'https://www.eichlers.com/pages/contact-us': '<p>info@eichlers.com</p>',
    }, { 'https://www.1800eichlers.com/': 'https://www.eichlers.com/' });
    const lead = { business_name: 'Eichlers Judaica', website: 'https://www.1800eichlers.com/' };
    const result = await new ContactEnricher({ http, config: US_CONTACTS(), log: () => {} }).enrich(lead);
    assert.equal(lead.email, 'info@eichlers.com');
    assert.equal(result.finalSite, 'https://www.eichlers.com/');
    assert.ok(result.pagesRead[0].includes('→ https://www.eichlers.com/'), 'the probe shows where the link led');
});

test('a JavaScript app shell is never rendered when the page has real text', async () => {
    let rendered = 0;
    const http = fakeHttp({
        'https://keterjudaica.com/': '<p>' + 'Keter Judaica — tallis, tefillin, menorahs, mezuzah cases and seforim in Borough Park. '.repeat(10) + '</p>',
    });
    http.fetchRendered = async () => { rendered++; return { ok: false }; };
    await new ContactEnricher({ http, config: US_CONTACTS(), log: () => {} }).enrich({ business_name: 'Keter Judaica', website: 'https://keterjudaica.com/' });
    assert.equal(rendered, 0, 'a normal page with no email is not re-read in the browser');
    assert.equal(looksLikeAppShell(['<title>Eichlers</title><div id="root"></div><script src="/app.js"></script>']), true);
    assert.equal(looksLikeAppShell(['<p>x</p>'.repeat(3) + 'a'.repeat(500), 'other page']), false);
});

test('smoke run: 1800eichlers.com is a JavaScript app; Chrome reads its contact page', async (t) => {
    const chromePath = await resolveChromePath('');
    if (!chromePath) { t.skip('no Chrome installed on this machine'); return; }
    // Every address answers 200 with the same shell; /app.js draws the page,
    // so the email is nowhere in the HTML a plain download gets.
    const shell = '<!doctype html><html><head><title>Eichlers Judaica</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
    const app = `const out = ['<a href="/contact">Contact us</a>'];
        for (const h of ['a', 'b', 'c', 'd']) out.push('<a href="https://' + h + '.example.org/">' + h + '</a>');
        if (location.pathname === '/contact') out.push('<p>Email: info@1800eichlers.com</p>');
        document.getElementById('root').innerHTML = out.join(' ');`;
    const server = http.createServer((req, res) => {
        if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(app); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(shell);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const site = `http://127.0.0.1:${server.address().port}/`;
    const factory = await createBrowserFactory({ config: { mode: 'local', headless: true, userDataDir: '' }, log: () => {} });
    const session = await factory.open();
    try {
        const client = createHttpClient({ transport: 'local', getBrowser: async () => session.browser, timeoutMs: 15000 });
        const lead = { business_name: 'Eichlers Judaica', website: site };
        const result = await new ContactEnricher({ http: client, config: US_CONTACTS(), log: () => {} }).enrich(lead);
        assert.equal(lead.email, 'info@1800eichlers.com');
        assert.ok(result.pagesRead.some(p => p.includes('(rendered)')));
    } finally {
        await factory.close(session);
        server.close();
    }
});

test('full US run: junk emails, menu-bar names, temples, thrift shops, names and halal markets', () => {
    // Emails
    assert.deepEqual(extractEmails('<a href="mailto:718-852-1111/segulahjudaica@gmail.com">Email</a>'), ['segulahjudaica@gmail.com']);
    assert.deepEqual(extractEmails('<style>/* licence: info@indiantypefoundry.com */</style><p>deli@newcitykosher.com</p>'), ['deli@newcitykosher.com']);
    assert.deepEqual(extractEmails('<p>support@gist-apps.com</p>'), []);
    assert.deepEqual(extractEmails('<p>team@latofonts.com lemonad@jovanny.ru in**@****me.com you@isp.com info@my-domain.com</p>'), []);
    // The web designer's, app vendor's or certifier's address is never the shop's email.
    assert.deepEqual(pickEmail(['contact@sansoxygen.com'], 'http://www.judaicacreations.com/', 'Judaica Creations'), { email: '', others: ['contact@sansoxygen.com'] });
    assert.equal(pickEmail(['newapp@ou.org'], 'https://oukosher.org/restaurants/shoprite', 'Kosher Experience').email, '');
    // …but a sister domain spelling the name, the site's own domain and freemail are.
    assert.equal(isThirdPartyEmail('sales@greenfeldjudaica.com', 'http://www.greenfieldjudaica.com/', 'Greenfeld Judaica'), false);
    assert.equal(isThirdPartyEmail('web@malchutfinejudaica.com', 'http://www.malchutjudaica.com/', 'Malchut Judaica'), false);
    assert.equal(isThirdPartyEmail('rmasel@earthlink.net', 'http://www.reuvenmasel.com/', 'Reuven Masel Judaica Store'), false);
    assert.equal(isThirdPartyEmail('ruthsbookstore@cjh.org', 'https://ruthsbookstore.cjh.org/', "Ruth's Bookstore"), false);
    assert.equal(isThirdPartyEmail('shop@anywhere.com', 'https://www.facebook.com/shop', 'Shop'), false, 'a platform page proves nothing');
    // Elite Sterling was greeted "Dear Shopping My Account Wish".
    assert.equal(extractContact('Owner: Shopping My Account Wish List').name, '');

    // Not buyers
    for (const [business_name, category] of [
        ['Judaica Gift Shop at Temple Torat Emet', 'Gift shop'],
        ['National Council of Jewish Women Thrift Shop', 'Thrift Store'],
        ['The National Council of Jewish Women', 'Thrift Store'],
        ['Chabad Thrift Store', 'Thrift Store'],
    ]) assert.equal(isSellable({ business_name, category }).ok, false, business_name);
    assert.equal(isSellable({ business_name: 'Chabad Judaica Store', category: 'Judaica store' }).ok, true, 'a Chabad-run shop still sells');

    // "Israel" as a person's name, "Jerusalem" alone, halal markets, brand "Menorah", restaurant delis
    for (const [business_name, category] of [
        ['Barbara Israel Garden Antiques', 'Antique Store'],
        ['Israel Rose Jewelry', 'Jeweler'],
        ['Israel Bien, The Jewelry Insider', 'Jewelry Designer'],
        ['Jerusalem Market', 'Grocery Store'],
        ['Jerusalem Mediterranean Market (halal)', 'Grocery Store'],
        ['Jerusalem International Food Market (سوبر ماركت القدس)', 'Supermarket'],
        ['Menorah Medical Supply', 'Medical Supply Store'],
        ['Menorah Collections Inc', 'Clothing Store'],
        ['Eppes Essen Deli & Restaurant', 'Deli'],
        ["Sarge's Delicatessen & Diner", 'Deli'],
    ]) assert.ok(!targetOf({ business_name, category }), business_name);
    // Its own name on its website is not evidence either.
    assert.ok(!targetOf({ business_name: 'Menorah Medical Supply', category: 'Medical Supply Store' }, 'Menorah Medical Supply — wheelchairs, walkers. Menorah'));
    for (const [business_name, category] of [
        ['Taste of Israel', 'Nut Store'],
        ['Israel Book Shop', 'Religious Goods Store'],
        ['Jerusalem Israeli Gift Shop', 'Religious Goods Store'],
        ['Menorah Judaica & Gifts', 'Store'],
        ['Menorah', 'Religious Goods Store'],
        ['Menorah Galleries', 'Antique Store'],
        ['Menorah.net', 'Manufacturer'],
        ['Glatt Mart', 'Kosher Grocery Store'],
    ]) assert.ok(targetOf({ business_name, category }), business_name);
});
