import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import {
    extractEmails, rankEmails, deobfuscate, decodeCfEmail, extractContactName, extractContact,
    greetingFor, findContactLinks, repairTld, shortBusinessName, guessContactUrls, findSocialLinks, registrableDomain, ContactEnricher,
} from '../src/contacts.js';
import { createHttpClient } from '../src/http.js';
import { stripHtml } from '../src/util.js';

const SHOP = path.join(import.meta.dirname, 'fixtures', 'shop');
const read = (f) => fs.readFileSync(path.join(SHOP, f), 'utf8');

test('Cloudflare-protected addresses are decoded', () => {
    assert.equal(decodeCfEmail('5a2932352a1a302f3e3b33393b77323b2f29743e3f'), 'shop@judaica-haus.de');
    assert.ok(extractEmails(read('impressum.html')).includes('shop@judaica-haus.de'));
});

test('human obfuscations are undone', () => {
    assert.equal(deobfuscate('info [at] laden [dot] de'), 'info@laden.de');
    assert.equal(deobfuscate('info(at)laden.de'), 'info@laden.de');
    assert.equal(deobfuscate('info {ät} laden (punkt) de'), 'info@laden.de');
    assert.equal(deobfuscate('kontakt at judaica-shop dot de'), 'kontakt@judaica-shop.de');
});

test('image filenames and placeholder addresses are not emails', () => {
    const got = extractEmails('<img src="logo@2x.png"> max.mustermann@example.com name@domain.de <a href="mailto:Info@Shop.de?subject=x">x</a>');
    assert.deepEqual(got, ['info@shop.de']);
});

test("the shop's own domain beats the web agency and privacy inbox", () => {
    const ranked = rankEmails(
        ['hello@pixelagentur.de', 'datenschutz@judaica-haus.de', 'shop@judaica-haus.de', 'owner@gmail.com'],
        'https://www.judaica-haus.de/');
    assert.equal(ranked[0], 'shop@judaica-haus.de');
    assert.equal(ranked[ranked.length - 1], 'hello@pixelagentur.de');
});

test('registrable domain handles subdomains and co.uk', () => {
    assert.equal(registrableDomain('shop.judaica-haus.de'), 'judaica-haus.de');
    assert.equal(registrableDomain('www.example.co.uk'), 'example.co.uk');
});

test('the Impressum names the person, not the company or the next field', () => {
    const text = stripHtml(read('impressum.html'));
    assert.equal(extractContactName(text), 'Frau Dr. Miriam Rosenthal');
    assert.equal(extractContact(text).role, 'Geschäftsführerin');

    assert.equal(extractContactName('Inhaber: David Levi Fasanenstraße 5 10623 Berlin'), 'David Levi');
    assert.equal(extractContactName('Geschäftsführer: Max von Weizsäcker, Anna Beispiel'), 'Max von Weizsäcker');
    assert.equal(extractContactName('Inh. Sarah Cohen Telefon 030 123'), 'Sarah Cohen');
    assert.equal(extractContactName('Vertreten durch: Judaica GmbH'), '', 'a company is not a person');
    assert.equal(extractContactName('Impressum Kontakt Telefon'), '');
});

test('greeting uses a gendered form only when the site said so', () => {
    assert.equal(greetingFor({ contact_name: 'Frau Dr. Miriam Rosenthal' }), 'Dear Ms. Dr. Rosenthal');
    assert.equal(greetingFor({ contact_name: 'Herr Max von Weizsäcker' }), 'Dear Mr. von Weizsäcker');
    // The masculine label is generic in German ("Inhaber: Irene Jaworski").
    assert.equal(greetingFor({ contact_name: 'David Levi', contact_role: 'Inhaber' }), 'Dear David Levi');
    assert.equal(greetingFor({ contact_name: 'Irene Jaworski', contact_role: 'Inhaber' }), 'Dear Irene Jaworski');
    assert.equal(greetingFor({ contact_name: 'Dipl.-Ing. Avi Chmelnik', contact_role: 'Geschäftsführer' }), 'Dear Avi Chmelnik');
    assert.equal(greetingFor({ contact_name: 'Sarah Cohen' }), 'Dear Sarah Cohen');
    assert.equal(greetingFor({ business_name: 'Judaica Haus Berlin' }), 'Dear Judaica Haus Berlin Team');
    assert.equal(greetingFor({}), 'Dear Sir or Madam');
});

test('contact links stay on the site and the Impressum comes first', () => {
    const links = findContactLinks(read('index.html'), 'https://www.judaica-haus.de/');
    assert.equal(links[0], 'https://www.judaica-haus.de/impressum');
    assert.ok(links.includes('https://www.judaica-haus.de/kontakt'));
    assert.ok(!links.some(u => u.includes('agentur')), 'followed the web agency');
    assert.deepEqual(guessContactUrls('https://x.de/shop/abc').slice(0, 2), ['https://x.de/impressum', 'https://x.de/kontakt']);
});

test('social links skip share buttons', () => {
    assert.deepEqual(findSocialLinks(read('index.html')), {
        facebook: 'https://www.facebook.com/JudaicaHausBerlin', instagram: '',
    });
});

test('end to end: homepage → Impressum gives email, person and site text', async (t) => {
    const server = http.createServer((req, res) => {
        const file = { '/': 'index.html', '/impressum': 'impressum.html' }[req.url];
        if (!file) { res.writeHead(404); res.end('nope'); return; }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(read(file));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}/`;

    const enricher = new ContactEnricher({
        http: createHttpClient({ transport: 'local' }),
        config: { delayMs: 0 },
        log: () => {},
    });
    const lead = { business_name: 'Judaica Haus Berlin', website: base };
    await enricher.enqueue(lead);
    await enricher.drain();

    // 127.0.0.1 is not the shop's domain, so ranking falls back to prefixes.
    assert.equal(lead.email, 'shop@judaica-haus.de');
    assert.equal(lead.contact_name, 'Frau Dr. Miriam Rosenthal');
    assert.equal(lead.facebook_url, 'https://www.facebook.com/JudaicaHausBerlin');
    assert.match(lead._siteText, /Kiddusch-Becher/);
    assert.ok(!lead.email.includes('pixelagentur'));
});

test('a site that is down still completes the lead', async () => {
    const enricher = new ContactEnricher({
        http: createHttpClient({ transport: 'local', timeoutMs: 2000 }),
        config: { delayMs: 0 }, log: () => {},
    });
    const lead = { business_name: 'Gone', website: 'http://127.0.0.1:9/', email: '' };
    await enricher.enqueue(lead);
    assert.equal(lead.email, '');
});

test("a web agency's footer address loses even without a domain to match", () => {
    assert.equal(rankEmails(['hello@pixelagentur.de', 'shop@judaica-haus.de'], '', '')[0], 'shop@judaica-haus.de');
    assert.equal(rankEmails(['hello@pixelagentur.de', 'shop@judaica-haus.de'], 'http://127.0.0.1:8080/', 'Judaica Haus')[0], 'shop@judaica-haus.de');
});

test('real run: a job title before the name and a sentence after it are not the name', () => {
    // Jewish Museum Berlin's Impressum produced "Dear Direktorin Hetty Berg Die".
    const c = extractContact('Vertreten durch: Direktorin Hetty Berg Die Stiftung Jüdisches Museum Berlin ist eine Stiftung');
    assert.deepEqual(c, { name: 'Hetty Berg', role: 'Direktorin' });
    assert.equal(greetingFor({ contact_name: c.name, contact_role: c.role }), 'Dear Ms. Berg');
});

test('real run: a street is not a person', () => {
    // Jewish Community of Berlin produced "Dear Oranienburger Str".
    assert.equal(extractContactName('Vertreten durch: Oranienburger Str. 28-31 10117 Berlin'), '');
    assert.equal(extractContactName('Vertreten durch: Oranienburger Str 28'), '');
    assert.equal(extractContactName('Inhaber: David Levi Oranienburger Str. 5'), 'David Levi');
});

test('real run: phone digits glued onto an address are removed', () => {
    // Jewish Museum Berlin produced "300info@jmberlin.de".
    assert.deepEqual(extractEmails('<p>Tel. +49 30 25993 300info@jmberlin.de</p><a href="mailto:info@jmberlin.de">x</a>'), ['info@jmberlin.de']);
    assert.deepEqual(extractEmails('<p>24h: 24hshop@x.de</p>'), ['24hshop@x.de'], 'digits that are not a known prefix stay');
});

test('full run: trailing junk after an Impressum name is cut', () => {
    const cases = [
        ['Geschäftsführerin: Kirsten Roschlaub Sitz der Gesellschaft: Hamburg', 'Kirsten Roschlaub'],
        ['Inhaber: Irene Jaworski Plattform der EU-Kommission', 'Irene Jaworski'],
        ['Inhaber: Daniel Opoku Holzstr 12', 'Daniel Opoku'],
        ['Verantwortlich: Hannah Kubsch Kontaktformular Anrede', 'Hannah Kubsch'],
        ['Vertreten durch: Prof. Dr. Mirjam Wenzel Online- Redaktion', 'Prof. Dr. Mirjam Wenzel'],
        ['Inhaber: Martin Koenitz Dittrichring 13', 'Martin Koenitz'],
        ['Verantwortlich: Dr. Ursula Reuter Bibliothek Germania Judaica', 'Dr. Ursula Reuter'],
        ['Vertreten durch: Evangelische Brüdergemeinde Korntal', ''],
    ];
    for (const [text, want] of cases) assert.equal(extractContactName(text), want, text);
    assert.equal(greetingFor({ contact_name: 'Kirsten Roschlaub', contact_role: 'Geschäftsführerin' }), 'Dear Ms. Roschlaub');
});

test('full run: words glued onto an address are trimmed or the copy dropped', () => {
    assert.equal(repairTld('info@israelladen.deein'), 'info@israelladen.de');
    assert.equal(repairTld('buchladen@neuer-weg.comtel'), 'buchladen@neuer-weg.com');
    assert.equal(repairTld('hello@iraja.art'), 'hello@iraja.art');
    assert.equal(repairTld('x@y.zzzzq'), '');
    assert.deepEqual(extractEmails('<script>var a="\\ninfo@kosherstar.de"</script><a href="mailto:info@kosherstar.de">x</a>'), ['info@kosherstar.de']);
    assert.deepEqual(extractEmails('<p>ihello@iraja.art</p><a href="mailto:hello@iraja.art">x</a>'), ['hello@iraja.art']);
});

test("full run: a platform's or umbrella organisation's inbox loses to the shop's", () => {
    assert.deepEqual(extractEmails('<p>behoerdenanfragen@kleinanzeigen.de impressum@kleinanzeigen.de</p>'), []);
    // Kosher King's listing links to a page deep inside Chabad Düsseldorf's site.
    assert.equal(rankEmails(['info@chabad-duesseldorf.de', 'royal.k.food@gmail.com'],
        'https://www.chabad-duesseldorf.de/templates/articlecco_cdo/aid/3860766', 'Kosher King')[0], 'royal.k.food@gmail.com');
    // Israelladen is run by a church parish; its own inbox names the shop.
    assert.equal(rankEmails(['pfarramt@bruedergemeinde-korntal.de', 'israelladen@mail.bgkorntal.de'],
        'https://www.bruedergemeinde-korntal.de/innovation/israelladen.html', 'Israelladen "Shalom al Israel"')[0], 'israelladen@mail.bgkorntal.de');
    // A shop's own homepage still wins as before.
    assert.equal(rankEmails(['kontakt@doronia.de', 'x@gmail.com'], 'https://www.doronia.de/', 'DORONIA Shipping GmbH')[0], 'kontakt@doronia.de');
});

test('full run: greetings use the shop\'s real name, not its Maps SEO title', () => {
    const cases = [
        ['Israel Spezialitäten | Die besten Medjoul Datteln | Dieterich', 'Israel Spezialitäten'],
        ['MIO GIO Therapy Cosmetics I Kosher Food I Judaica', 'MIO GIO Therapy Cosmetics'],
        ['KosherLife - koschere Lebensmittel', 'KosherLife'],
        ['KosherStar GbR', 'KosherStar'],
        ['Kosher Market GmbH', 'Kosher Market'],
        ['JEWERIA® - Jewish jewelry', 'JEWERIA'],
        ['Judaica-Laden in Berlin יודאיקה בברלין', 'Judaica-Laden in Berlin'],
        ['Brא\u200euch', 'Brא\u200euch'],
        ['Old Abraham GbR - Vielfalt aus Israel und der Welt', 'Old Abraham'],
    ];
    for (const [name, want] of cases) assert.equal(shortBusinessName(name), want, name);
    assert.equal(greetingFor({ business_name: 'KosherStar GbR' }), 'Dear KosherStar Team');
});
