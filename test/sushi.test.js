import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { JSDOM } from 'jsdom';

import { resolveCountry, resolveLocations, buildQueryMatrix } from '../src/config.js';
import { scoreRelevance, isTarget } from '../src/relevance.js';
import { PLATFORM_DOMAIN, extractEmails } from '../src/contacts.js';
import { pickCity } from '../src/maps.js';
import { extractDetail, extractFeedCards } from '../src/dom-extract.js';
import { classifyWhatsApp, WA } from '../src/whatsapp.js';
import { loadTemplate, renderEmail } from '../src/email-template.js';
import { loadWhatsAppTemplate } from '../src/whatsapp.js';
import { createSaver, prepareLeads, buildMailMerge } from '../src/output.js';

const SUSHI = resolveCountry({ country: 'IL', campaign: 'sushi' });
/** A place found by the Israeli sushi campaign. */
const place = (business_name, category, extra = {}) => ({ business_name, category, country: 'IL', campaign: 'sushi', ...extra });
const tierOf = (lead, siteText = '') => scoreRelevance(lead, siteText).tier;
const targetOf = (lead, siteText = '') => isTarget({ relevance_tier: tierOf(lead, siteText) }, SUSHI.includeTiers);

test('the sushi campaign is Israel with its own terms, places, templates and folder', () => {
    assert.equal(SUSHI.code, 'IL');
    assert.equal(SUSHI.campaign, 'sushi');
    assert.equal(SUSHI.outputDir, 'output-il-sushi');
    assert.equal(SUSHI.workbook, 'sushi-leads.xlsx');
    assert.equal(SUSHI.script, 'sushi:israel');
    assert.equal(SUSHI.phoneCode, '972');
    assert.deepEqual(SUSHI.includeTiers, ['Sushi place', 'Japanese / Asian restaurant']);
    // The Judaica profile is untouched.
    const IL = resolveCountry({ country: 'IL' });
    assert.equal(IL.outputDir, 'output-il');
    assert.equal(IL.campaign, undefined);
    assert.equal(resolveCountry({ country: 'IL', campaign: 'judaica' }).outputDir, 'output-il');

    assert.throws(() => resolveCountry({ country: 'DE', campaign: 'sushi' }), /Israel only/);
    assert.throws(() => resolveCountry({ country: 'IL', campaign: 'pizza' }), /Unknown campaign/);

    const locs = resolveLocations({ country: 'IL', campaign: 'sushi' }, () => {});
    for (const city of ['Tel Aviv', 'Old North, Tel Aviv', 'Florentin, Tel Aviv', 'German Colony, Jerusalem', 'Carmel Center, Haifa',
        'Eilat', 'Nazareth', 'Kiryat Ono', 'Herzliya Pituach, Herzliya']) {
        assert.ok(locs.some(l => l.city === city), city);
    }
    assert.ok(!locs.some(l => l.city === 'Mea Shearim, Jerusalem'), 'the Judaica districts are not restaurant streets');
    const q = buildQueryMatrix(locs, SUSHI.categories, SUSHI.highYield);
    assert.equal(q[0].text, 'סושי Jerusalem');
    // Every place is searched for "סושי" before any Japanese or Asian term.
    assert.ok(q.slice(0, locs.length).every(x => x.category === 'סושי'));
});

test('sushi places: the word in the name, category or description, in Hebrew or English', () => {
    assert.equal(tierOf(place('Sushi Samba', 'Restaurant')), 'Sushi place');
    assert.equal(tierOf(place('Zozobra', 'Sushi restaurant')), 'Sushi place');
    assert.equal(tierOf(place('סושי בר הכרמל', 'Restaurant')), 'Sushi place');
    // Hebrew prefixes: "הסושיה", "בסושי".
    assert.equal(tierOf(place('הסושיה', 'Meal delivery')), 'Sushi place');
    // Caterers and takeaways serve sushi too.
    assert.equal(tierOf(place('סושי לאירועים', 'Caterer')), 'Sushi place');
    assert.equal(tierOf(place('Moshiko', 'Restaurant', { maps_description: 'Casual spot for sushi and noodles' })), 'Sushi place');
    assert.ok(targetOf(place('Sushi Samba', 'Restaurant')));
});

test('Japanese and Asian restaurants are the second tier, and move up when the menu has sushi', () => {
    assert.equal(tierOf(place('Japanika', 'Asian restaurant')), 'Japanese / Asian restaurant');
    assert.equal(tierOf(place('Nini Hachi', 'Japanese restaurant')), 'Japanese / Asian restaurant');
    assert.equal(tierOf(place('Wok Republic', 'Restaurant')), 'Japanese / Asian restaurant');
    assert.equal(tierOf(place('Poke Bowl TLV', 'Poke bar')), 'Japanese / Asian restaurant');
    assert.equal(tierOf(place('מסעדה סינית', 'Restaurant')), 'Japanese / Asian restaurant');
    assert.equal(tierOf(place('Japanika', 'Asian restaurant'), 'התפריט: סושי, ראמן, נודלס'), 'Sushi place');
    assert.ok(targetOf(place('Nini Hachi', 'Japanese restaurant')));
});

test('another restaurant needs sushi on its menu, not one mention, and "making" is not maki', () => {
    assert.equal(tierOf(place('Shila', 'Seafood restaurant'), 'Our menu: sushi, sashimi and more.'), 'Sushi place');
    assert.equal(tierOf(place('Shila', 'Seafood restaurant'), 'Salmon, as fresh as in sushi.'), 'Other restaurant');
    assert.equal(tierOf(place('Making Burgers', 'Hamburger restaurant'), 'Making the best burgers since 2010'), 'Other restaurant');
    assert.equal(tierOf(place('Cafe Landwer', 'Cafe')), 'Other restaurant');
    assert.equal(tierOf(place('Sinai Grill', 'Grill')), 'Other restaurant');
    assert.ok(!targetOf(place('Cafe Landwer', 'Cafe')));
});

test('a supermarket sushi counter, a supplier, a fish shop or a cooking school is not a buyer', () => {
    assert.equal(tierOf(place('Shufersal Deal', 'Supermarket', { maps_description: 'Sushi counter' })), 'Not a restaurant');
    assert.equal(tierOf(place('Sushi Supplies Ltd', 'Restaurant supply store')), 'Not a restaurant');
    assert.equal(tierOf(place('Yakimono', 'Japanese grocery store')), 'Not a restaurant');
    assert.equal(tierOf(place('דגי הים', 'Fish store')), 'Not a restaurant');
    assert.ok(!targetOf(place('Sushi Academy', 'Cooking school')));
    assert.equal(tierOf(place('בית כנסת הגדול', 'Synagogue')), 'Non-profit / religious');
    // What the feed drops before opening the place.
    assert.ok(SUSHI.dropAtFeed.includes(tierOf(place('Shufersal Deal', 'Supermarket'))));
    assert.ok(!SUSHI.dropAtFeed.includes(tierOf(place('Cafe Landwer', 'Cafe'))));
});

test('a Judaica run still scores restaurants as not retailers', () => {
    assert.equal(scoreRelevance({ business_name: 'Sushi Samba', category: 'Restaurant', country: 'IL' }).tier, 'Not a retailer');
});

test('ordering and booking sites are not a restaurant\'s website', () => {
    for (const host of ['wolt.com', 'www.10bis.co.il', 'mishloha.co.il', 'ontopo.com', 'ontopo.co.il', 'tabitisrael.co.il',
        'tabit.cloud', 'www.rest.co.il', 'www.ubereats.com', 'www.opentable.com']) {
        assert.ok(PLATFORM_DOMAIN.test(host), host);
    }
    assert.ok(!PLATFORM_DOMAIN.test('japanika.net'));
    assert.ok(!PLATFORM_DOMAIN.test('restaurant.co.il'));
});

test('the sushi email and WhatsApp message are Hebrew, labelled, with an opt-out', () => {
    const t = loadTemplate(SUSHI.emailTemplate);
    assert.match(t.subject, /^פרסומת/);
    assert.match(t.subject, /צלחות וכוסות זכוכית/);
    assert.match(t.body, /הסר/);
    const e = renderEmail({ business_name: 'Japanika | ג\'פניקה' }, t, { name: 'Sam', title: 'Sales' });
    assert.match(e.body, /ראינו את Japanika,/);
    assert.doesNotMatch(e.subject + e.body, /\{\{/);
    const wa = loadWhatsAppTemplate(SUSHI.whatsappTemplate);
    assert.match(wa, /צלחות הגשה וכוסות/);
    assert.match(wa, /הסר/);
});

test('sushi output: sushi places first, its own workbook, and the mail merge holds both target tiers', async () => {
    const leads = [
        place('Cafe Landwer', 'Cafe', { email: 'cafe@landwer.co.il', relevance_tier: 'Other restaurant', relevance_score: 10, maps_url: 'https://www.google.com/maps/place/a' }),
        place('Japanika', 'Asian restaurant', { email: 'info@japanika.net', relevance_tier: 'Japanese / Asian restaurant', relevance_score: 25, maps_url: 'https://www.google.com/maps/place/b' }),
        place('Sushi Samba', 'Sushi restaurant', { email: 'hello@sushisamba.co.il', relevance_tier: 'Sushi place', relevance_score: 80, maps_url: 'https://www.google.com/maps/place/c' }),
    ];
    const tpl = loadTemplate(SUSHI.emailTemplate);
    const rows = prepareLeads(leads, { template: tpl, includeTiers: SUSHI.includeTiers, whatsappTemplate: loadWhatsAppTemplate(SUSHI.whatsappTemplate) });
    assert.deepEqual(rows.map(r => r.business_name), ['Sushi Samba', 'Japanika', 'Cafe Landwer']);
    const csv = buildMailMerge(rows, SUSHI.includeTiers);
    assert.match(csv, /hello@sushisamba/);
    assert.match(csv, /info@japanika/);
    assert.doesNotMatch(csv, /cafe@landwer/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sushi-out-'));
    const save = createSaver(dir, { template: tpl, includeTiers: SUSHI.includeTiers, workbook: SUSHI.workbook, log: () => {} });
    await save(leads);
    assert.ok(fs.existsSync(path.join(dir, 'sushi-leads.xlsx')));
    assert.ok(!fs.existsSync(path.join(dir, 'judaica-leads.xlsx')));
    fs.rmSync(dir, { recursive: true, force: true });
});

/** Read a Maps detail panel with the Israeli phone code. */
const detail = (inner) => {
    const dom = new JSDOM(`<div role="main"><h1 class="DUwDvf">X</h1>${inner}</div>`, { url: 'https://www.google.com/maps/place/x' });
    const prev = global.document;
    global.document = dom.window.document;
    try { return extractDetail('972'); } finally { global.document = prev; }
};

test('full sushi run: a 1-700 number is Israeli, not American, and has no WhatsApp', () => {
    // 1-700-500-876 came back as +1 1700500876, "Check — US number".
    const phone = detail('<button data-item-id="phone:tel:1700500876"></button>').phone;
    assert.equal(phone, '+9721700500876');
    assert.equal(detail('<button data-item-id="phone:tel:1599504917"></button>').phone, '+9721599504917');
    const wa = classifyWhatsApp({ phone });
    assert.equal(wa.status, WA.SERVICE);
    assert.equal(wa.number, '');
    // A WhatsApp link on the site still wins.
    assert.equal(classifyWhatsApp({ phone, whatsapp_site_numbers: '+972541234567' }).status, WA.LINK_SITE);
    // Ordinary Israeli numbers are unchanged.
    assert.equal(detail('<button data-item-id="phone:tel:054-123-4567"></button>').phone, '+972541234567');
});

test('full sushi run: Arad, Romania, Canada, Hebron and Bethlehem are outside Israel', () => {
    for (const a of ['Strada Pădurii 65, 310123 Arad, Romania', '3017 St Johns St, Port Moody, BC V3H 2C4, Canada',
        'H33R+57H, Hebron', 'Hebron', 'P6C3+3HJ, Caritas St. Qubbet Raheel,, Bethlehem', 'Star St 171, Bethlehem']) {
        assert.ok(SUSHI.foreign.test(a), a);
    }
    for (const a of ['Derech Levi Eshkol 93, Kiryat Ono', 'Kiryat Arba', 'HaMa\'ayan St 1, Efrat', 'Kakal St 18, Arad']) {
        assert.ok(!SUSHI.foreign.test(a), a);
    }
    // Arad is searched as "Arad, Israel"; the City column still says Arad.
    const locs = resolveLocations({ country: 'IL', campaign: 'sushi' }, () => {});
    assert.ok(locs.some(l => l.city === 'Arad, Israel'));
    assert.equal(pickCity('', 'Arad, Israel', SUSHI), 'Arad');
});

test('full sushi run: Asian words need a kitchen — spas, clinics and a park are not restaurants', () => {
    assert.equal(tierOf(place('ספא יוקרתי בהרצליה - Tomoko Japanese Spa', 'Spa')), 'Not a restaurant');
    assert.equal(tierOf(place('o spa - ספא ראש יפני', 'Spa')), 'Not a restaurant');
    assert.equal(tierOf(place('קליניקה לרפואה סינית', 'Chinese Medicine Clinic')), 'Not a restaurant');
    assert.equal(tierOf(place('Japanese Garden', 'Garden'), 'sushi sushi'), 'Not a restaurant');
    // A name that says it serves food wins over a shop category.
    assert.equal(tierOf(place('Sushi restaurant 🍣', 'Grocery Store')), 'Sushi place');
    assert.equal(tierOf(place('צ׳ילי בייבי - מכולת ובית אוכל אסייתי', 'Asian Grocery Store')), 'Japanese / Asian restaurant');
    assert.equal(tierOf(place('Sumo Asian kitchen', 'Food And Beverage Consultant')), 'Japanese / Asian restaurant');
    assert.equal(tierOf(place('תאי אסיאן פוד - חנות בוטיק למוצרי מזון אסיאתי', 'Asian Grocery Store')), 'Not a restaurant');
    // A gastropub and a Hebrew category are restaurants.
    assert.equal(tierOf(place('מסעדת מיה ביץ', 'Gastropub'), 'סושי וסושי'), 'Sushi place');
    assert.equal(tierOf(place('Loco Roll Express', 'מסעדה'), 'פוטומאקי, סושי'), 'Sushi place');
    // Sushi in the name still counts under an odd category.
    assert.equal(tierOf(place('Tzalil Taim Sushi', 'Shipping Service')), 'Sushi place');
});

test('full sushi run: directory and delivery-site inboxes are not the restaurant\'s', () => {
    // israelbusinessguide.com put its own gmail on 23 restaurants; Bali B Click
    // its eilat.bali@ on two; Valuecard dan@valuecard.co.il on one.
    for (const host of ['israelbusinessguide.com', 'balibclick.co.il', 'valuecard.co.il', 'el-gaucho-na.rol.co.il', 'www.happycow.net']) {
        assert.ok(PLATFORM_DOMAIN.test(host), host);
    }
    // Mishlohim pages are read: the restaurant's address on them counts, Mishlohim's own never does.
    assert.deepEqual(extractEmails('<a href="mailto:info@mishlohim.co.il">x</a> <a href="mailto:karmela17262@gmail.com">y</a>'), ['karmela17262@gmail.com']);
    assert.ok(!PLATFORM_DOMAIN.test('www.mishlohim.co.il'));
});

test('full sushi run: "No reviews", an address and a hotel blurb are not categories', () => {
    assert.equal(detail('<button class="DkEaL">HotelSlick hostel with a trendy bistro</button>').category, 'Hotel');
    assert.equal(detail('<button class="DkEaL">RestaurantModern hotel with sea views &amp; a pool</button>').category, 'Restaurant');
    assert.equal(detail('<button class="DkEaL">No Reviews</button>').category, '');
    assert.equal(detail('<button class="DkEaL">Kosher Restaurant</button>').category, 'Kosher Restaurant');

    // The same in a feed card: a rating row reading "No reviews", a row with only an address.
    const card = (rows) => `<div class="Nv2PK"><a class="hfpxzc" href="https://www.google.com/maps/place/A/data=!1s0x1" aria-label="A"></a>
        <div class="qBF1Pd fontHeadlineSmall">A</div>${rows.map(r => `<div class="W4Efsd">${r}</div>`).join('')}</div>`;
    const feed = (rows) => {
        const dom = new JSDOM(`<div role="feed">${card(rows)}</div>`, { url: 'https://www.google.com/maps/search/x' });
        const prev = global.document;
        global.document = dom.window.document;
        try { return extractFeedCards()[0].category; } finally { global.document = prev; }
    };
    assert.equal(feed(['No reviews', "שד' הרצל 39", 'Sushi restaurant · שד\' הרצל 39']), 'Sushi restaurant');
    assert.equal(feed(['HotelSlick hostel with a trendy bistro']), 'Hotel');
});
