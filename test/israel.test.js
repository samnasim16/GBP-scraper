import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import { resolveCountry, resolveLocations, buildQueryMatrix } from '../src/config.js';
import { mapsSearchUrl, cityFromAddress, pickCity } from '../src/maps.js';
import { extractDetail } from '../src/dom-extract.js';
import { classifyWhatsApp, WA, loadWhatsAppTemplate } from '../src/whatsapp.js';
import { scoreRelevance, isSellable, isPublicBody, isTarget } from '../src/relevance.js';
import { findContactLinks, registrableDomain, rankEmails, shortBusinessName } from '../src/contacts.js';
import { loadTemplate, renderEmail } from '../src/email-template.js';
import { prepareLeads } from '../src/output.js';

const IL = resolveCountry({ country: 'IL' });
/** An Israeli listing (scoring reads the market from lead.country). */
const il = (business_name, category, extra = {}) => ({ business_name, category, country: 'IL', ...extra });
const tierOf = (lead, siteText = '') => scoreRelevance(lead, siteText).tier;
const targetOf = (lead, siteText = '') => isTarget({ relevance_tier: tierOf(lead, siteText) }, IL.includeTiers);

test('Israel is its own market: Hebrew terms first, every district, its own folder', () => {
    for (const name of ['IL', 'Israel', 'israël', 'ISR']) assert.equal(resolveCountry({ country: name }).code, 'IL');
    assert.equal(IL.outputDir, 'output-il');
    assert.equal(IL.phoneCode, '972');
    assert.equal(IL.script, 'israel');
    assert.deepEqual(IL.includeTiers, ['Judaica seller', 'Glass & gift shop']);
    const locs = resolveLocations({ country: 'IL' }, () => {});
    for (const city of ['Jerusalem', 'Mea Shearim, Jerusalem', 'Geula, Jerusalem', 'Bnei Brak', 'Safed', 'Artists Colony, Safed', 'Holon', 'Eilat', "Modi'in Illit"]) {
        assert.ok(locs.some(l => l.city === city), city);
    }
    const q = buildQueryMatrix(locs, IL.categories, IL.highYield);
    assert.equal(q[0].text, 'יודאיקה Jerusalem');
    assert.equal(mapsSearchUrl('יודאיקה Jerusalem', IL.gl), 'https://www.google.com/maps/search/%D7%99%D7%95%D7%93%D7%90%D7%99%D7%A7%D7%94%20Jerusalem?hl=en&gl=il');
});

test('Israeli addresses and phones', () => {
    assert.equal(cityFromAddress('King George St 20, Jerusalem, 9414205', 'IL'), 'Jerusalem');
    assert.equal(cityFromAddress('Rabbi Akiva St 100, Bnei Brak, Israel', 'IL'), 'Bnei Brak');
    assert.equal(cityFromAddress('המלאכה 39, חולון', 'IL'), 'חולון');
    assert.equal(pickCity('Rabbi Akiva St 100, Bnei Brak', 'Tel Aviv', IL), 'Bnei Brak');
    assert.equal(pickCity('', 'Geula, Jerusalem', IL), 'Jerusalem');
    assert.ok(IL.foreign.test('Rainbow St, Amman, Jordan'));
    assert.ok(!IL.foreign.test('Jaffa St 1, Jerusalem'));

    const read = (tel) => {
        const dom = new JSDOM(`<div role="main"><h1 class="DUwDvf">X</h1><button data-item-id="phone:tel:${tel}"></button></div>`,
            { url: 'https://www.google.com/maps/place/x' });
        const prev = global.document;
        global.document = dom.window.document;
        try { return extractDetail('972').phone; } finally { global.document = prev; }
    };
    assert.equal(read('02-623-4567'), '+97226234567');
    assert.equal(read('054-123-4567'), '+972541234567');
    // Israeli mobiles (05…) are almost always on WhatsApp; landlines are worth a check.
    assert.equal(classifyWhatsApp({ phone: '+972541234567' }).status, WA.MOBILE);
    assert.equal(classifyWhatsApp({ phone: '+97226234567' }).status, WA.LANDLINE);
});

test('Hebrew Judaica shops are sellers, prefixes and all; a lamp shop is not', () => {
    assert.equal(tierOf(il('יודאיקה גאולה', 'Gift shop')), 'Judaica seller');
    assert.equal(tierOf(il('כלי קודש והמזוזות של רחוב מלכי ישראל', 'Store')), 'Judaica seller');
    assert.equal(tierOf(il('ספרי קודש בני ברק', 'Book store')), 'Judaica seller');
    assert.equal(tierOf(il('חנות ספרים', 'Book store'), 'טליתות, תפילין, חנוכיות וגביעי קידוש'), 'Judaica seller');
    // מנורה is any lamp in Hebrew.
    assert.notEqual(tierOf(il('מנורות ותאורה', 'Lighting store')), 'Judaica seller');
});

test('Israel: kosher context says nothing; gift, souvenir and art shops are targets', () => {
    // Every Israeli supermarket is kosher: not a target.
    assert.equal(targetOf(il('שופרסל דיל', 'Supermarket', { maps_description: 'Kosher supermarket' })), false);
    assert.equal(targetOf(il('Jerusalem Bakery', 'Bakery')), false);
    // The gift, souvenir and art shops that sell Judaica to visitors are.
    assert.equal(tierOf(il('Ben Yehuda Gifts', 'Gift shop')), 'Glass & gift shop');
    assert.equal(tierOf(il('מזכרות העיר העתיקה', 'Souvenir store')), 'Glass & gift shop');
    assert.equal(tierOf(il('Tzfat Gallery of Mystical Art', 'Art gallery')), 'Glass & gift shop');
    assert.equal(targetOf(il('Ben Yehuda Gifts', 'Gift shop')), true);
    // Outside Israel, context still counts as before.
    assert.equal(tierOf({ business_name: 'Glatt Mart', category: 'Kosher Grocery Store' }), 'Jewish / Israeli retail');
});

test('Hebrew synagogues, yeshivas, gemachs and non-profits are not buyers', () => {
    for (const [business_name, category] of [
        ['בית כנסת הגדול', 'Synagogue'],
        ['ישיבת מיר', 'Yeshiva'],
        ['גמ"ח כלים', 'Store'],
        ['עמותת חסדי נעמי', 'Non-profit organization'],
        ['מוזיאון ישראל', 'Museum'],
        ['Gemach Kallah', 'Store'],
    ]) assert.equal(isSellable({ business_name, category }).ok, false, business_name);
    assert.equal(isSellable({ business_name: 'יודאיקה בית הכנסת בע"מ', category: 'Judaica store' }).ok, true, 'a company (בע"מ) is a shop');
    assert.equal(isPublicBody({ website: 'https://www.jerusalem.muni.il/he/' }), true);
    assert.equal(isPublicBody({ website: 'https://www.gov.il/he/' }), true);
});

test('Hebrew contact pages, .co.il domains and Israeli inboxes', () => {
    const links = findContactLinks('<a href="/%D7%A6%D7%95%D7%A8-%D7%A7%D7%A9%D7%A8">צור קשר</a><a href="/about">אודות</a><a href="/cart">סל</a>', 'https://www.judaica-shop.co.il/', { max: 4 });
    assert.ok(links.includes('https://www.judaica-shop.co.il/%D7%A6%D7%95%D7%A8-%D7%A7%D7%A9%D7%A8'));
    assert.ok(!links.some(u => u.endsWith('/cart')));
    assert.equal(registrableDomain('www.judaica-shop.co.il'), 'judaica-shop.co.il');
    assert.equal(registrableDomain('www.jerusalem.muni.il'), 'jerusalem.muni.il');
    // A walla.co.il inbox beats a web agency's.
    assert.equal(rankEmails(['studio@webagency.co.il', 'judaica123@walla.co.il'], 'https://www.judaica-shop.co.il/', 'Judaica Shop')[0], 'judaica123@walla.co.il');
});

test('the Israeli email and WhatsApp message are in Hebrew and follow the anti-spam law', () => {
    const tpl = loadTemplate(IL.emailTemplate);
    // The law wants "פרסומת" at the start of the subject and a way to opt out.
    assert.match(tpl.subject, /^פרסומת/);
    const { body } = renderEmail({ business_name: 'יודאיקה גאולה | כלי קודש' }, tpl, { name: 'Sam', title: 'Sales' });
    assert.match(body, /ראינו שבחנות יודאיקה גאולה נמכרים/);
    assert.match(body, /הסר/);
    assert.match(body, /053-302-3636/);
    const wa = loadWhatsAppTemplate(IL.whatsappTemplate);
    assert.match(wa, /הסר/);
    const [row] = prepareLeads([{ business_name: 'יודאיקה גאולה', relevance_tier: 'Judaica seller', phone: '+972541234567', country: 'IL' }], { whatsappTemplate: wa });
    assert.match(row.whatsapp_link, /^https:\/\/wa\.me\/972541234567\?text=/);
    assert.match(decodeURIComponent(row.whatsapp_link), /יודאיקה גאולה/);
    assert.ok(fs.existsSync(IL.whatsappTemplate));
});

test('smoke run: Hebrew shop names are shortened, not emptied', () => {
    assert.equal(shortBusinessName('כפתור ופרח יודאיקה - החנות'), 'כפתור ופרח יודאיקה');
    assert.equal(shortBusinessName('חנות יודאיקה ותשמישי קדושה - מרקוביץ רקמה'), 'חנות יודאיקה ותשמישי קדושה');
    assert.equal(shortBusinessName('טלית סנטר'), 'טלית סנטר');
    assert.equal(shortBusinessName('| פרוכת לארון קודש | Jerusalem Yarmulka |'), 'פרוכת לארון קודש');
    // A Hebrew translation after a Latin name is still dropped.
    assert.equal(shortBusinessName('Tallis Center טלית סנטר'), 'Tallis Center');
});
