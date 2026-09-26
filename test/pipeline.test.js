import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scoreRelevance, isTarget, isSellable } from '../src/relevance.js';
import { resolveLocations, buildQueryMatrix, GERMAN_CITIES } from '../src/config.js';
import { loadTemplate, renderEmail } from '../src/email-template.js';
import { prepareLeads, buildMailMerge, buildCSV, createSaver } from '../src/output.js';
import { mapsSearchUrl, placeKey } from '../src/maps.js';

test('relevance: a Judaica shop, a kosher restaurant, a synagogue, a restorer', () => {
    assert.equal(scoreRelevance({ business_name: 'Judaica Haus', category: 'Gift shop' }).tier, 'Judaica seller');
    assert.equal(scoreRelevance({ business_name: 'Restaurant Tel Aviv', category: 'Israeli restaurant' }).tier, 'Not a retailer');
    assert.equal(scoreRelevance({ business_name: 'Synagoge Rykestraße', category: 'Synagogue' }).tier, 'Non-profit / religious');
    // "Restaurierung" contains "tora" — must not read as Torah.
    assert.equal(scoreRelevance({ business_name: 'Restaurierung Schmidt', category: 'Furniture store' }).tier, 'Unrelated');
});

test('relevance: the website can promote a generic gift shop', () => {
    const lead = { business_name: 'Glaskunst Müller', category: 'Art gallery' };
    assert.equal(scoreRelevance(lead).tier, 'Glass & gift shop');
    assert.equal(scoreRelevance(lead, 'Handgemachte Menora und Kiddusch-Becher aus Glas').tier, 'Judaica seller');
});

test('relevance: a Jewish bookshop counts as Jewish/Israeli retail', () => {
    const r = scoreRelevance({ business_name: 'Buchhandlung am Markt', category: 'Book store', maps_description: 'Jüdische Literatur und Bücher aus Israel' });
    assert.equal(r.tier, 'Jewish / Israeli retail');
    assert.ok(isTarget({ relevance_tier: r.tier }));
    assert.ok(!isTarget({ relevance_tier: 'Glass & gift shop' }), 'gift shops are opt-in');
});

test('locations cover every Bundesland and split the big cities into districts', () => {
    const all = resolveLocations({});
    const states = new Set(all.map(l => l.state));
    assert.equal(states.size, Object.keys(GERMAN_CITIES).length);
    assert.ok(all.some(l => l.city === 'Charlottenburg, Berlin'));
    assert.ok(all.some(l => l.city === 'Worms'));

    const only = resolveLocations({ cities: ['Worms'], districts: false });
    assert.deepEqual(only, [{ state: '', city: 'Worms' }]);
    assert.deepEqual(resolveLocations({ states: ['sl'], districts: false }).map(l => l.city), ['Saarbrücken']);
});

test('query matrix runs high-yield terms across every city first', () => {
    const q = buildQueryMatrix([{ state: 'BE', city: 'Berlin' }, { state: 'HH', city: 'Hamburg' }], ['Kunstglas Galerie', 'Judaica']);
    assert.deepEqual(q.map(x => x.text), ['Judaica Berlin', 'Judaica Hamburg', 'Kunstglas Galerie Berlin', 'Kunstglas Galerie Hamburg']);
});

test('Maps is searched in Germany with an English UI', () => {
    assert.equal(mapsSearchUrl('Judaica München'), 'https://www.google.com/maps/search/Judaica%20M%C3%BCnchen?hl=en&gl=de');
});

test('the email template renders the exact pitch with name and sender', () => {
    const tpl = loadTemplate();
    assert.equal(tpl.subject, 'Handcrafted Kosher Glass Judaica from Israel – Partnership Inquiry');
    const e = renderEmail({ contact_name: 'Frau Miriam Rosenthal', business_name: 'Judaica Haus' }, tpl, { name: 'Dana Levi', title: 'Export Manager' });
    assert.match(e.body, /^Dear Ms\. Rosenthal,\n\nMy name is Dana Levi, and I am reaching out on behalf of Jaffa Glass/);
    assert.match(e.body, /24-karat gold/);
    assert.match(e.body, /11 Socrates St\., Tel Aviv-Jaffa/);
    assert.match(e.body, /Warm regards,\nDana Levi\nExport Manager\nJaffa Glass\n$/);
    assert.doesNotMatch(e.body, /\{\{|\[Name\]/);

    const anon = renderEmail({ business_name: 'Judaica Haus' }, tpl, {});
    assert.match(anon.body, /^Dear Judaica Haus Team,/);
    assert.match(anon.body, /\[Your Name\]/, 'a missing sender stays visibly unfilled');
});

const LEADS = [
    { business_name: 'Judaica Haus', relevance_tier: 'Judaica seller', relevance_score: 70, email: 'shop@judaica-haus.de', contact_name: 'Miriam Rosenthal', phone: '+49301234567', maps_url: 'https://www.google.com/maps/place/x/data=!1s0x1:0x2', _siteText: 'lots' },
    { business_name: 'Judaica Haus (dup)', relevance_tier: 'Judaica seller', relevance_score: 40, email: '', phone: '+49301234567', maps_url: 'https://www.google.com/maps/place/y' },
    { business_name: 'Café Tel Aviv', relevance_tier: 'Not a retailer', relevance_score: 10, email: 'cafe@x.de', phone: '+4930999', maps_url: '' },
    { business_name: '=HYPERLINK("evil")', relevance_tier: 'Jewish / Israeli retail', relevance_score: 30, email: '', phone: '+4940111', maps_url: '' },
];

test('prepare: dedupes by phone/place, best tier first, internal fields dropped', () => {
    const rows = prepareLeads(LEADS, { template: loadTemplate(), sender: { name: 'Dana' } });
    assert.deepEqual(rows.map(r => r.business_name), ['Judaica Haus', '=HYPERLINK("evil")', 'Café Tel Aviv']);
    assert.equal(rows[0]._siteText, undefined);
    assert.equal(rows[0].greeting, 'Dear Miriam Rosenthal');
    assert.match(rows[0].email_body, /^Dear Miriam Rosenthal,/);
});

test('mail merge only includes targets that have an address', () => {
    const rows = prepareLeads(LEADS, { template: loadTemplate() });
    const csv = buildMailMerge(rows, ['Judaica seller', 'Jewish / Israeli retail']);
    const lines = csv.replace(/^﻿/, '').split('\n');
    assert.equal(lines[0], 'email,greeting,contact_name,business_name,city,website,email_subject,email_body');
    assert.match(csv, /shop@judaica-haus\.de/);
    assert.doesNotMatch(csv, /cafe@x\.de/, 'a café is not a target');
});

test('CSV neutralises formula injection', () => {
    assert.match(buildCSV([{ business_name: '=HYPERLINK("evil")' }], ['business_name']), /'=HYPERLINK/);
});

test('saver writes every deliverable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judaica-out-'));
    const save = createSaver(dir, { template: loadTemplate(), sender: {}, log: () => {} });
    await save(LEADS);
    for (const f of ['judaica-leads.xlsx', 'mail-merge.csv', 'leads.csv', 'leads.json']) {
        assert.ok(fs.existsSync(path.join(dir, f)), f);
    }
    fs.rmSync(dir, { recursive: true, force: true });
});

test('place ids are read from Maps URLs', () => {
    assert.equal(placeKey('https://www.google.com/maps/place/A/data=!4m7!3m6!1s0x47a851:0x2f0c!8m2'), '0x47a851:0x2f0c');
});

test('real run: synagogues, communities, institutes and museums are not sellable', () => {
    // Every one of these came back from "Judaica Hamburg/Bremen/Berlin".
    const noSale = [
        ['Chabad of Hamburg', 'Synagogue'],
        ['Jüdische Gemeinde in Hamburg', 'Community Center'],
        ['Liberal Jewish Community Hamburg', 'Reform Synagogue'],
        ['Institut für die Geschichte der deutschen Juden', 'Research Institute'],
        ['Jewish community in the land of Bremen', 'Religious Institution'],
        ['Precious Kassim', 'Synagogue'],
        ['Chabad Lubawitsch Bremen', 'Non-profit Organization'],
        ['New Synagogue Berlin - Centrum Judaicum', 'Museum'],
        ['Jewish Museum Berlin', 'History Museum'],
        ['Deutsch-Israelische Gesellschaft Bremen e.V.', ''],
        ['Freundeskreis Israel e. V.', 'Association'],
    ];
    for (const [business_name, category] of noSale) {
        assert.equal(isSellable({ business_name, category }).ok, false, business_name);
        assert.ok(!isTarget(scoreRelevance({ business_name, category }, 'Shop Menora Kiddusch Jüdisch Israel')), business_name);
    }
});

test('real run: shops stay, even when run by a community or miscategorised', () => {
    const shops = [
        ['Judaica-Laden in Berlin יודאיקה בברלין', 'Judaica Store'],
        ['Chabad Judaica Shop', 'Gift shop'],
        ['Judaica Direct', 'Public Library'],        // Maps' category is wrong
        ['KOSHER DAILY MARKT', 'Kosher Grocery Store'],
        ['Felix Jud', 'Book Store'],
    ];
    for (const [business_name, category] of shops) {
        assert.equal(isSellable({ business_name, category }).ok, true, business_name);
    }
    assert.equal(scoreRelevance({ business_name: 'Judaica Direct', category: 'Public Library' }).tier, 'Judaica seller');
});

test('a "Shop" link on a website does not make an organisation a retailer', () => {
    // The Bremen community and the Hamburg institute were rated retail
    // because their websites link to a shop page.
    const r = scoreRelevance({ business_name: 'Kulturforum Mitte', category: 'Event venue' }, 'Jüdisch Israel Shop Spenden');
    assert.equal(r.tier, 'Unrelated');
});
