import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { resolveCountry, resolveLocations, buildQueryMatrix } from '../src/config.js';
import { scoreRelevance, isSellable, isTarget } from '../src/relevance.js';
import { SPECIALTIES } from '../src/art.js';
import { ContactEnricher } from '../src/contacts.js';
import { relevanceFields, scrapeQuery, pickCity } from '../src/maps.js';
import { extractFeedCards, extractDetail } from '../src/dom-extract.js';
import { loadTemplate, renderEmail } from '../src/email-template.js';
import { loadWhatsAppTemplate } from '../src/whatsapp.js';
import { createSaver, prepareLeads } from '../src/output.js';
import { runKey, resumePoint } from '../src/resume.js';

const IL_ART = resolveCountry({ country: 'IL', campaign: 'art' });
/** A place found by the Israeli art campaign. */
const place = (business_name, category, extra = {}) => ({ business_name, category, country: 'IL', campaign: 'art', ...extra });
const tierOf = (lead, siteText = '') => scoreRelevance(lead, siteText).tier;
const fieldsOf = (lead, siteText = '', links = []) => relevanceFields({ ...lead, _siteLinks: links }, siteText);
const droppedAtFeed = (lead) => {
    const r = scoreRelevance(lead);
    return !isSellable(lead).ok || (IL_ART.dropAtFeed.includes(r.tier) && !r.provisional);
};

/** The contract the Varnish importer reads (as in art.test.js). */
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

test('Israel art: Hebrew terms first, Tel Aviv-Yafo and its gallery districts first, its own folder', () => {
    assert.equal(IL_ART.code, 'IL');
    assert.equal(IL_ART.campaign, 'art');
    assert.equal(IL_ART.name, 'Israel');
    assert.equal(IL_ART.outputDir, 'output-il-art');
    assert.equal(IL_ART.workbook, 'art-leads.xlsx');
    assert.equal(IL_ART.script, 'art:il');
    assert.equal(IL_ART.phoneCode, '972');
    assert.deepEqual(IL_ART.includeTiers, ['Gallery', 'Auction house', 'Art dealer', 'Art advisor']);
    // One term per kind of buyer, Hebrew then English.
    assert.deepEqual(IL_ART.highYield, ['גלריה לאמנות', 'Art gallery', 'בית מכירות פומביות', 'Auction house', 'סוחר אמנות', 'Art dealer', 'יועץ אמנות', 'Art advisor']);
    for (const term of ['גלריה', 'אמנות ישראלית', 'מכירה פומבית', 'Art auction', 'Contemporary art gallery']) assert.ok(IL_ART.categories.includes(term), term);
    // The art campaign's shared settings, as in the US.
    const US_ART = resolveCountry({ country: 'US', campaign: 'art' });
    for (const k of ['tiers', 'dropAtFeed', 'columns', 'followLinks', 'title', 'client']) assert.deepEqual(IL_ART[k], US_ART[k], k);
    // The Israeli Judaica and sushi profiles are untouched.
    const IL = resolveCountry({ country: 'IL' });
    assert.equal(IL.outputDir, 'output-il');
    assert.deepEqual(IL.includeTiers, ['Judaica seller', 'Glass & gift shop']);
    assert.match(IL.emailTemplate, /partnership-email-il\.txt$/);
    assert.equal(resolveCountry({ country: 'IL', campaign: 'sushi' }).outputDir, 'output-il-sushi');

    const locs = resolveLocations({ country: 'IL', campaign: 'art' }, () => {});
    assert.equal(locs[0].city, 'Tel Aviv-Yafo');
    for (const city of ['Gordon Street, Tel Aviv-Yafo', 'Florentin, Tel Aviv-Yafo', 'Neve Tzedek, Tel Aviv-Yafo', 'Old Jaffa, Tel Aviv-Yafo', 'Jaffa Port, Tel Aviv-Yafo',
        'Kiryat HaMelacha, Tel Aviv-Yafo', 'Ben Yehuda Street, Tel Aviv-Yafo', 'Dizengoff, Tel Aviv-Yafo', 'Jerusalem', 'Hutzot Hayotzer, Jerusalem', 'Musrara, Jerusalem',
        'German Colony, Jerusalem', 'Talbiya, Jerusalem', 'Haifa', 'Wadi Nisnas, Haifa', 'German Colony, Haifa', 'Herzliya', 'Ramat Gan', "Ra'anana", 'Kfar Saba',
        'Netanya', 'Caesarea', 'Ein Hod', 'Safed', 'Artists Colony, Safed', 'Rosh Pina', "Zikhron Ya'akov", 'Kiryat Tivon', "Be'er Sheva", 'Eilat', 'Mitzpe Ramon']) {
        assert.ok(locs.some(l => l.city === city), city);
    }
    // "Arad" alone is Romania; the Judaica districts (Mea Shearim) are not gallery districts.
    assert.ok(!locs.some(l => l.city === 'Arad' || /Mea Shearim/.test(l.city)));
    const q = buildQueryMatrix(locs, IL_ART.categories, IL_ART.highYield);
    assert.equal(q[0].text, 'גלריה לאמנות Tel Aviv-Yafo');
    assert.ok(q.slice(0, locs.length).every(x => x.category === 'גלריה לאמנות'));
    assert.ok(q.slice(locs.length, 2 * locs.length).every(x => x.category === 'Art gallery'));
    // The City column: the address town, or the searched city without its district.
    assert.equal(pickCity('', 'Gordon Street, Tel Aviv-Yafo', IL_ART), 'Tel Aviv-Yafo');
    assert.equal(pickCity('HaMenofim St 10, Herzliya', 'Tel Aviv-Yafo', IL_ART), 'Herzliya');
    assert.equal(pickCity('Gordon St 3, Tel Aviv-Yafo, 6345803', 'Gordon Street, Tel Aviv-Yafo', IL_ART), 'Tel Aviv-Yafo');
});

test('Israel art: input files, npm scripts, and a progress file of its own', () => {
    const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
    const pkg = read('package.json');
    assert.equal(pkg.scripts['art:il'], 'node src/main.js --input ./input.il-art.json');
    assert.equal(pkg.scripts['smoke:art:il'], 'node src/main.js --input ./input.il-art-smoke.json');
    const full = read('input.il-art.json');
    assert.equal(resolveCountry(full).campaign, 'art');
    assert.deepEqual(full.includeTiers, IL_ART.includeTiers);
    assert.equal(full.contacts.afterSearch, true);
    const smoke = read('input.il-art-smoke.json');
    assert.deepEqual(Object.keys(smoke), Object.keys(read('input.us-art-smoke.json')));
    assert.equal(resolveCountry(smoke).code, 'IL');
    assert.equal(smoke.cities.length, 1);
    assert.equal(smoke.searchCategories.length, 2);
    assert.equal(smoke.maxLeads, 10);
    assert.equal(smoke.browser.headless, false);
    assert.equal(smoke.outputDir, 'output-il-art-smoke');
    // progress.json is keyed by market and campaign: an art run never
    // resumes the Judaica or sushi run, even with the same number of queries.
    assert.equal(runKey(IL_ART), 'IL-art');
    assert.equal(runKey(resolveCountry({ country: 'IL', campaign: 'sushi' })), 'IL-sushi');
    assert.equal(runKey(resolveCountry({ country: 'IL' })), 'IL');
    const queries = Array.from({ length: 10 }, (_, i) => ({ text: `q${i}` }));
    assert.equal(resumePoint(queries, [], { country: 'IL-sushi', queries: 10, next: 7 }, runKey(IL_ART)), 0);
    assert.equal(resumePoint(queries, [], { country: 'IL-art', queries: 10, next: 7 }, runKey(IL_ART)), 7);
});

test('Israel art: galleries, auction houses, dealers and advisors from Hebrew names, categories and sites', () => {
    for (const [name, category, tier, site] of [
        ['גלריה גורדון', 'Art gallery', 'Gallery'],
        ['גלריית רו-ארט', '', 'Gallery'],
        ['הגלריה לאמנות ישראלית', 'Store', 'Gallery'],
        ['בית מכירות פומביות מטרו', 'Auction house', 'Auction house'],
        ['מכירות פומביות תירוש', 'Art gallery', 'Auction house'],
        ['רונית לוי - סוחרת אמנות', '', 'Art dealer'],
        ['דנה כהן ייעוץ אמנות', 'Consultant', 'Art advisor'],
        ['מיכל ברק - אוצרת ויועצת אמנות', 'Corporate office', 'Art advisor'],
        ['אוסף שפירא', 'Corporate office', 'Art advisor', 'ייעוץ לאספנים ובניית אוספי אמנות לחברות.'],
        ['אוסף שפירא', '', 'Art dealer', 'אנו קונים יצירות של אמנים ישראלים ותיקים.'],
        ['Rosenfeld Gallery', 'Art gallery', 'Gallery'],
    ]) {
        const lead = place(name, category);
        assert.equal(tierOf(lead, site), tier, name);
        assert.ok(isTarget({ relevance_tier: tierOf(lead, site) }, IL_ART.includeTiers), name);
    }
    assert.equal(fieldsOf(place('בית מכירות פומביות מטרו', 'Auction house')).art_type, 'auction_house');
    // A gallery's site with exhibitions makes a bare name a gallery.
    assert.equal(tierOf(place('אוסף שפירא', ''), 'תערוכה נוכחית: נופים. תערוכות קודמות.'), 'Gallery');
});

test('Israel art: framing beats "גלריה" unless the site shows exhibitions or represented artists; studios, supplies, classes and tattoo are not buyers', () => {
    assert.equal(tierOf(place('מסגרות אמנות', 'Picture frame shop')), 'Not a buyer');
    assert.equal(droppedAtFeed(place('מסגרות אמנות', 'Picture frame shop')), true);
    const framing = place('גלריה ומסגרות הדר', 'Art gallery');
    assert.equal(tierOf(framing), 'Not a buyer');
    assert.equal(droppedAtFeed(framing), false, 'it says gallery: its site is read');
    assert.equal(tierOf(framing, 'מסגור תמונות, הדפסים וקנבסים.'), 'Not a buyer');
    assert.equal(tierOf(framing, 'התערוכה הנוכחית: צבע. פתיחת התערוכה ביום חמישי.'), 'Gallery');
    assert.equal(tierOf(framing, 'הגלריה מייצגת שנים עשר אמנים מהצפון.'), 'Gallery');
    assert.equal(tierOf(place('המסגרייה של יוסי', 'Store')), 'Not a buyer');
    for (const [name, category] of [
        ['סטודיו לאמנות של דנה', 'Artist'],
        ['חנות יצירה ארט', 'Craft store'],
        ['חומרי אמנות גורדון', 'Store'],
        ['חוגי ציור לילדים', 'Art studio'],
        ['סדנת קרמיקה בנמל', 'Art gallery'],
        ['קעקועים בפלורנטין', 'Tattoo shop'],
        ['בית דפוס הגלריה', 'Print shop'],
        ['עיצוב פנים מיכל', 'Interior designer'],
        ['גלריה קפה', 'Cafe'],
    ]) {
        assert.equal(tierOf(place(name, category)), 'Not a buyer', name);
        assert.equal(fieldsOf(place(name, category)).art_type, '', name);
    }
    // An artist's own studio needs represented artists, not a CV of exhibitions.
    assert.equal(tierOf(place('דנה כהן סטודיו', 'Art gallery'), 'תערוכות: 2019 תערוכת יחיד.'), 'Not a buyer');
    assert.equal(tierOf(place('דנה כהן סטודיו', 'Art gallery'), 'אמני הגלריה: רון, נועה, טל.'), 'Gallery');
});

test('Israel art: museums, artists\' houses, municipal galleries and non-profits are Non-profit / museum; בע"מ keeps a company commercial', () => {
    for (const [name, category] of [
        ['מוזיאון תל אביב לאמנות', 'Art museum'],
        ['בית האמנים ירושלים', 'Art gallery'],
        ['סדנאות האמנים', 'Art gallery'],
        ['הגלריה העירונית רחובות', 'Art gallery'],
        ['מרכז לאמנות עכשווית', 'Art gallery'],
        ['עמותת אמני הגליל', 'Art gallery'],
        ['המשכן לאמנות עין חרוד', 'Museum'],
        ['גלריה באוניברסיטת חיפה', 'Art gallery'],
        ['מתנ"ס נווה צדק - גלריה', 'Art gallery'],
    ]) {
        const lead = place(name, category);
        assert.equal(isSellable(lead).ok, false, name);
        assert.equal(tierOf(lead), 'Non-profit / museum', name);
        assert.equal(droppedAtFeed(lead), true, name);
    }
    assert.equal(isSellable(place('מרכז לאמנות בע"מ', 'Art gallery')).ok, true);
    assert.equal(tierOf(place('מרכז לאמנות בע"מ', 'Art gallery')), 'Gallery');
    // The site can say so; a donation to one does not.
    assert.equal(tierOf(place('גלריה בנמל', 'Art gallery'), 'הגלריה היא עמותה רשומה הפועלת לקידום אמנים.'), 'Non-profit / museum');
    assert.equal(tierOf(place('גלריה בנמל', 'Art gallery'), 'עשרה אחוזים מההכנסות נתרמים לעמותה.'), 'Gallery');
});

test('Israel art: accepts_submissions in Hebrew — "no" in the usual phrasings, "yes" with a call or guidelines, "no" wins', () => {
    const subs = (site, links = []) => fieldsOf(place('גלריה גורדון', 'Art gallery'), site, links).accepts_submissions;
    for (const site of [
        'הגלריה אינה מקבלת הגשות של אמנים.',
        'איננו מקבלים תיקי עבודות.',
        'לא מקבלים פניות של אמנים.',
        'אין קבלת עבודות.',
        'ההגשות סגורות.',
        'הגלריה סגורה להגשות.',
        'נא לא לשלוח תיקי עבודות.',
        'ייצוג אמנים בהזמנה בלבד.',
    ]) assert.equal(subs(site), 'no', site);
    for (const site of [
        'הגשת עבודות: שלחו תיק עבודות למייל.',
        'קול קורא לאמנים צעירים.',
        'אמנים מוזמנים להגיש עבודות לתערוכה הקבוצתית.',
        'הנחיות להגשה',
    ]) assert.equal(subs(site), 'yes', site);
    assert.equal(subs('הגשת עבודות: איננו מקבלים הגשות כרגע.'), 'no');
    assert.equal(subs('תערוכות קודמות. אמני הגלריה.'), 'unknown');
    // How to send is not a refusal; works refused for sale are consignments.
    assert.notEqual(subs('איננו מקבלים עבודות בדואר, רק דרך הטופס באתר.'), 'no');
    assert.notEqual(subs('איננו מקבלים עבודות למכירה כרגע.'), 'no');
    // Work sent for a valuation is a consignment.
    const valuation = fieldsOf(place('בית מכירות פומביות מטרו', 'Auction house'), 'שלחו לנו עבודות להערכת שווי.');
    assert.equal(valuation.accepts_submissions, 'unknown');
    assert.equal(valuation.accepts_consignments, 'yes');
    // A Hebrew submissions page among the links.
    const url = 'https://gordon-gallery.co.il/%D7%94%D7%92%D7%A9%D7%AA-%D7%A2%D7%91%D7%95%D7%93%D7%95%D7%AA';
    const f = fieldsOf(place('גלריה גורדון', 'Art gallery'), '', [{ url, text: 'הגשת עבודות' }]);
    assert.equal(f.accepts_submissions, 'yes');
    assert.equal(f.submission_url, url);
});

test('Israel art: accepts_consignments in Hebrew; a refusal is unknown', () => {
    const consign = (site) => fieldsOf(place('בית מכירות פומביות מטרו', 'Auction house'), site).accepts_consignments;
    for (const site of [
        'מסירה למכירה',
        'קבלת יצירות למכירה הפומבית הבאה.',
        'אנו מקבלים עבודות למכירה בכל ימות השבוע.',
        'קנייה ומכירה של אמנות ישראלית.',
        'אנו קונים יצירות של אמנים ישראלים.',
        'שמאות והערכת שווי לאוספים.',
        'שמאי אמנות מוסמך.',
    ]) assert.equal(consign(site), 'yes', site);
    assert.equal(consign('מכירות פומביות קודמות ותוצאות.'), 'unknown');
    assert.equal(consign('איננו מקבלים עבודות למכירה כרגע. שמאות'), 'unknown');
    const url = 'https://metro-auctions.co.il/%D7%9E%D7%A1%D7%99%D7%A8%D7%94-%D7%9C%D7%9E%D7%9B%D7%99%D7%A8%D7%94';
    const f = fieldsOf(place('בית מכירות פומביות מטרו', 'Auction house'), '', [{ url: 'https://metro-auctions.co.il/catalog', text: 'קטלוג' }, { url, text: 'מסירה למכירה' }]);
    assert.equal(f.consign_url, url);
    assert.equal(f.accepts_consignments, 'yes');
    assert.equal(f.submission_url, '', 'מסירה למכירה is not an artist submission page');
});

test('Israel art: Hebrew specialties map onto the English vocabulary; credits and museum names do not count', () => {
    const spec = (site, extra = {}) => fieldsOf(place('גלריה גורדון', 'Art gallery', extra), site).specialties;
    assert.equal(spec('אמנות ישראלית עכשווית: ציור, צילום ופיסול, הדפסים ותחריטים, עבודות על נייר, קרמיקה ואמנים צעירים.'),
        'contemporary; photography; prints; sculpture; works on paper; ceramics; emerging artists; israeli art');
    assert.equal(spec('אמנות מודרנית ואימפרסיוניזם. יודאיקה ותשמישי קדושה מכסף.'), 'modern; impressionist; judaica');
    assert.equal(spec('', { maps_description: 'Gallery of contemporary Israeli art' }), 'contemporary; israeli art');
    // "צילום: יוסי לוי" is a photo credit; "מוזיאון הרצליה לאמנות עכשווית" a museum.
    assert.equal(spec('צילום: יוסי לוי. צילום הצבה: דנה. ליד מוזיאון הרצליה לאמנות עכשווית.'), '');
    // הדפסה is printing, not prints.
    assert.equal(spec('שירותי הדפסה והדפסות על קנבס'), '');
    // israeli art and judaica close the list, as in Varnish's own (lib/leads/labels.ts).
    assert.deepEqual(SPECIALTIES.map(([w]) => w).slice(-3), ['emerging artists', 'israeli art', 'judaica']);
});

test('Israel art: phones are +972; IL Judaica and sushi scoring is unchanged', () => {
    const read = (tel) => {
        const dom = new JSDOM(`<div role="main"><h1 class="DUwDvf">X</h1><button data-item-id="phone:tel:${tel}"></button></div>`, { url: 'https://www.google.com/maps/place/x' });
        const prev = global.document;
        global.document = dom.window.document;
        try { return extractDetail(IL_ART.phoneCode, IL_ART.trunks || ['0']).phone; } finally { global.document = prev; }
    };
    assert.equal(read('03-523-4567'), '+97235234567');
    assert.equal(read('054-123-4567'), '+972541234567');
    assert.equal(read('+972 3-523-4567'), '+97235234567');
    // Without "campaign": "art", the same listings score as before.
    assert.equal(scoreRelevance({ business_name: 'יודאיקה גאולה', category: 'Gift shop', country: 'IL' }).tier, 'Judaica seller');
    assert.equal(scoreRelevance({ business_name: 'Tzfat Gallery of Mystical Art', category: 'Art gallery', country: 'IL' }).tier, 'Glass & gift shop');
    assert.equal(scoreRelevance({ business_name: 'גלריה גורדון', category: 'Art gallery', country: 'IL' }).tier, 'Glass & gift shop');
    assert.deepEqual(Object.keys(relevanceFields({ business_name: 'גלריה גורדון', category: 'Art gallery', country: 'IL' })), ['relevance_tier', 'relevance_score', 'relevance_evidence']);
    assert.equal(scoreRelevance({ business_name: 'סושי בר', category: 'Restaurant', country: 'IL', campaign: 'sushi' }).tier, 'Sushi place');
    assert.equal(scoreRelevance({ business_name: 'Udon House', category: 'Japanese restaurant', country: 'IL', campaign: 'sushi' }).tier, 'Japanese / Asian restaurant');
});

/** A fake website: path → HTML; anything else is a 404. */
function fakeHttp(pages) {
    const fetched = [];
    return {
        fetched,
        async fetchText(url) {
            fetched.push(url);
            const u = new URL(url);
            const body = pages[decodeURIComponent(u.origin + u.pathname)];
            return body ? { ok: true, status: 200, body, url } : { ok: false, status: 404, body: '', url };
        },
    };
}

test('Israel art end to end: a Hebrew gallery site gives the email, its submissions page and its specialties', async () => {
    const site = 'https://www.gordon-gallery.co.il';
    const http = fakeHttp({
        [`${site}/`]: '<nav><a href="/תערוכות">תערוכות</a> <a href="/צור-קשר">צור קשר</a> <a href="/הגשת-עבודות">הגשת עבודות</a></nav>'
            + '<h1>גלריה גורדון</h1><p>התערוכה הנוכחית: נוף ישראלי. אמני הגלריה: רון, נועה וטל. אמנות ישראלית עכשווית, ציור ופיסול.</p>',
        [`${site}/צור-קשר`]: '<p>רחוב גורדון 3, תל אביב-יפו</p><p>info@gordon-gallery.co.il</p>',
        [`${site}/הגשת-עבודות`]: '<h1>הגשת עבודות</h1><p>אמנים מוזמנים להגיש תיק עבודות לכתובת submissions@gordon-gallery.co.il.</p>',
    });
    const lead = place('גלריה גורדון', 'Art gallery', { website: `${site}/`, phone: '+97235234567', phone_code: '972' });
    const config = { phoneCode: IL_ART.phoneCode, keyPage: IL_ART.contactKeyPage, guessPaths: IL_ART.contactPaths, followLinks: IL_ART.followLinks, delayMs: 0, concurrency: 1 };
    await new ContactEnricher({ http, config, log: () => {} }).enrich(lead);
    Object.assign(lead, relevanceFields(lead, lead._siteText));
    assert.ok(http.fetched.some(u => decodeURIComponent(u).endsWith('/הגשת-עבודות')), 'the submissions page is read');
    assert.equal(lead.email, 'info@gordon-gallery.co.il');
    assert.equal(lead.relevance_tier, 'Gallery');
    assert.equal(lead.accepts_submissions, 'yes');
    assert.equal(decodeURIComponent(lead.submission_url), `${site}/הגשת-עבודות`);
    assert.equal(lead.accepts_consignments, 'unknown');
    assert.equal(lead.specialties, 'contemporary; sculpture; israeli art');
    assertContract(lead);
});

test('Israel art feed: frame shops, museums and the West Bank are dropped; every lead is +972, Israel, no region, with the contract fields', async () => {
    let current = '';
    const logs = [];
    const card = (id, name, category) => ({ name, href: `https://www.google.com/maps/place/${id}/data=!1s0x1:0x${id}`, category, rating: 4.7, reviewCount: 60, closedFlag: false });
    const cards = [
        card('a', 'גלריה גורדון', 'Art gallery'),
        card('b', 'מסגרות אמנות', 'Picture frame shop'),
        card('c', 'מוזיאון תל אביב לאמנות', 'Art museum'),
        card('d', 'בית מכירות פומביות מטרו', 'Auction house'),
        card('e', 'Bethlehem Icons Gallery', 'Art gallery'),
        card('f', 'גלריה ומסגרות הדר', 'Art gallery'),
    ];
    const details = {
        a: { name: 'גלריה גורדון', address: 'Gordon St 3, Tel Aviv-Yafo, 6345803', category: 'Art gallery', phone: '+97235234567', rating: 4.7, reviews: 60, description: 'Contemporary Israeli art' },
        d: { name: 'בית מכירות פומביות מטרו', address: 'Ben Yehuda St 50, Tel Aviv-Yafo', category: 'Auction house', phone: '+97235271111', rating: 4.5, reviews: 90, description: 'מכירות פומביות של אמנות ישראלית. קבלת יצירות למכירה.' },
        e: { name: 'Bethlehem Icons Gallery', address: 'Manger St, Bethlehem, Palestine', category: 'Art gallery', phone: '+97022741234', rating: 4.9, reviews: 20 },
        f: { name: 'גלריה ומסגרות הדר', address: 'HaHistadrut Ave 12, Haifa', category: 'Art gallery', phone: '+97248671234', rating: 4.4, reviews: 15 },
    };
    const page = {
        url: () => current || 'https://www.google.com/maps/search/x',
        goto: async (u) => { current = u; },
        $: async (sel) => (sel === 'div[role="feed"]' || sel === 'h1.DUwDvf' ? {} : null),
        $$eval: async () => cards.length,
        waitForSelector: async () => {},
        bringToFront: async () => {},
        evaluate: async (fn, arg) => {
            if (fn === extractFeedCards) return cards;
            if (fn === extractDetail) {
                assert.equal(arg, '972', 'the Israeli phone code');
                return details[current.match(/place\/(\w)/)[1]];
            }
            return null;
        },
    };
    const allLeads = [];
    await scrapeQuery(page, { text: 'גלריה לאמנות Tel Aviv-Yafo', city: 'Tel Aviv-Yafo', state: 'TA' }, { seen: new Set(), allLeads, log: (m) => logs.push(m) },
        { maxResultsPerQuery: 60, maxScrolls: 0, minReviews: 0, maxLeads: 100, delayBetweenListings: 0, keepNonProfits: false, country: IL_ART });
    assert.deepEqual(allLeads.map(l => l.business_name), ['גלריה גורדון', 'בית מכירות פומביות מטרו', 'גלריה ומסגרות הדר']);
    assert.ok(logs.some(m => /non-profit:1 not-a-buyer:1/.test(m)), logs.find(m => /Feed:/.test(m)));
    assert.ok(logs.some(m => /Outside Israel: Bethlehem/.test(m)));
    const [gordon, metro, hadar] = allLeads;
    for (const lead of allLeads) {
        assert.equal(lead.campaign, 'art');
        assert.equal(lead.country_name, 'Israel');
        assert.equal(lead.bundesland, '', 'Israeli addresses name no district');
        assert.match(lead.phone, /^\+972/);
        assertContract(lead);
    }
    assert.equal(gordon.city, 'Tel Aviv-Yafo');
    assert.equal(gordon.relevance_tier, 'Gallery');
    assert.equal(gordon.specialties, 'contemporary; israeli art');
    assert.equal(metro.relevance_tier, 'Auction house');
    assert.equal(metro.accepts_consignments, 'yes', 'from the Hebrew Maps description');
    assert.equal(hadar.city, 'Haifa');
    assert.equal(hadar.relevance_tier, 'Not a buyer', 'until its site shows exhibitions');
});

test('Israel art: the Hebrew email and WhatsApp message ask once to list the buyer, with פרסומת and an opt-out', async () => {
    const t = loadTemplate(IL_ART.emailTemplate);
    assert.match(t.subject, /^פרסומת \| /);
    const e = renderEmail({ business_name: 'גלריה גורדון | אמנות ישראלית עכשווית' }, t);
    assert.equal(e.subject, 'פרסומת | בקשה לכלול את גלריה גורדון במדריך קוני האמנות של Varnish AI');
    assert.match(e.body, /Varnish AI/);
    assert.match(e.body, /האם תסכימו שנכלול אתכם\?/);
    assert.match(e.body, /השיבו "הסר"/);
    assert.match(e.body, /\[Your Name\]\n\[Title\]\nVarnish AI\n\[כתובת למשלוח דואר\]\n$/, 'sender details left for the user');
    assert.doesNotMatch(e.subject + e.body, /\{\{|Jaffa|Zack|\d{3}-\d{3}/);
    const named = renderEmail({ business_name: 'גלריה גורדון' }, t, { name: 'דנה לוי', title: 'שותפויות' });
    assert.match(named.body, /שמי דנה לוי/);
    const wa = loadWhatsAppTemplate(IL_ART.whatsappTemplate);
    assert.match(wa, /^פרסומת/);
    assert.match(wa, /Varnish AI/);
    assert.match(wa, /"הסר"/);
    assert.doesNotMatch(wa, /Jaffa|\+\d/);
    const [r] = prepareLeads([place('גלריה גורדון', 'Art gallery', { relevance_tier: 'Gallery', phone: '+97235234567' })], { whatsappTemplate: wa, includeTiers: IL_ART.includeTiers });
    assert.match(r.whatsapp_link, /^https:\/\/wa\.me\/97235234567\?text=/);
    assert.match(decodeURIComponent(r.whatsapp_link), /גלריה גורדון/);

    // The workbook and leads.json, as for the US.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'il-art-'));
    const lead = { ...place('גלריה גורדון', 'Art gallery'), email: 'info@gordon-gallery.co.il', phone: '+97235234567', city: 'Tel Aviv-Yafo', bundesland: '',
        country_name: 'Israel', maps_url: 'https://www.google.com/maps/place/a', observed_date: '2026-11-10' };
    Object.assign(lead, relevanceFields(lead, 'אמנות ישראלית עכשווית'));
    await createSaver(dir, { template: t, whatsappTemplate: wa, includeTiers: IL_ART.includeTiers, workbook: IL_ART.workbook, columns: IL_ART.columns, log: () => {} })([lead]);
    const [row] = JSON.parse(fs.readFileSync(path.join(dir, 'leads.json'), 'utf8'));
    assert.equal(row.specialties, 'contemporary; israeli art');
    assert.equal(row.country_name, 'Israel');
    assertContract(row);
    assert.match(fs.readFileSync(path.join(dir, 'mail-merge.csv'), 'utf8'), /פרסומת/);
    assert.ok(fs.existsSync(path.join(dir, 'art-leads.xlsx')));
    fs.rmSync(dir, { recursive: true, force: true });
});

test('Israel art "places": by district code, or under "IL"; known cities come out as the full run has them', () => {
    const locs = resolveLocations({ country: 'IL', campaign: 'art', places: { TA: ['Tel Aviv-Yafo'], IL: ['Jerusalem', 'Kfar Yona', 'Tel Aviv-Yafo, Israel'] }, districts: false }, () => {});
    assert.deepEqual(locs.map(l => `${l.state} ${l.city}`), ['TA Tel Aviv-Yafo', 'JM Jerusalem', 'IL Kfar Yona']);
    const full = resolveLocations({ country: 'IL', campaign: 'art' }, () => {});
    for (const l of locs.slice(0, 2)) assert.ok(full.some(f => f.state === l.state && f.city === l.city), l.city);
    // Districts come with a known city.
    const withDistricts = resolveLocations({ country: 'IL', campaign: 'art', places: { IL: ['Jerusalem'] } }, () => {});
    assert.ok(withDistricts.some(l => l.state === 'JM' && l.city === 'Hutzot Hayotzer, Jerusalem'));
    // "Arad" alone is Arad, Romania: under IL it is the sushi run's own "Arad, Israel".
    assert.deepEqual(resolveLocations({ country: 'IL', campaign: 'sushi', places: { IL: ['arad'] }, districts: false }, () => {}), [{ state: 'SO', city: 'Arad, Israel' }]);
});
