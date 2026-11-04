import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { extractWhatsApp, classifyWhatsApp, isMobile, normaliseNumber, whatsappLink, WA, loadWhatsAppTemplate } from '../src/whatsapp.js';
import { prepareLeads } from '../src/output.js';
import { ContactEnricher } from '../src/contacts.js';
import { createHttpClient } from '../src/http.js';

test('WhatsApp links on a website give the number', () => {
    const html = `
        <a href="https://wa.me/447958131295?text=Hi">Chat</a>
        <a href="https://api.whatsapp.com/send?phone=442039896001&amp;text=Hello">WhatsApp us</a>
        <a href="whatsapp://send?phone=+33612345678">app</a>`;
    const r = extractWhatsApp(html, '44');
    assert.deepEqual(r.numbers, ['+447958131295', '+442039896001', '+33612345678']);
    assert.equal(r.linked, true);
});

test('a number written next to "WhatsApp" counts; a bare mention is weaker', () => {
    const r = extractWhatsApp('<p>Commandes par WhatsApp : 06 12 34 56 78</p>', '33');
    assert.deepEqual(r.numbers, ['+33612345678']);
    const m = extractWhatsApp('<footer>Follow us on Instagram and WhatsApp</footer>', '33');
    assert.deepEqual(m, { numbers: [], linked: false, mentioned: true });
    assert.equal(extractWhatsApp('<div class="whatsapp-float"></div>', '32').linked, true, 'a chat widget');
    assert.deepEqual(extractWhatsApp('<p>Call 020 8455 0000</p>', '44'), { numbers: [], linked: false, mentioned: false });
});

test('mobiles are recognised per country', () => {
    for (const n of ['+447958131295', '+4917612345678', '+33612345678', '+32475123456', '+972543980747']) assert.equal(isMobile(n), true, n);
    for (const n of ['+442039896001', '+49301234567', '+33142345678', '+3232123456']) assert.equal(isMobile(n), false, n);
    assert.equal(normaliseNumber('0475 12 34 56', '32'), '+32475123456');
});

test('status and priority follow the strength of the evidence', () => {
    // From the England list: Arele's is a landline with WhatsApp Business.
    assert.equal(classifyWhatsApp({ phone: '+442039896001', whatsapp_site_numbers: '+442039896001' }).status, WA.LINK_SITE);
    assert.equal(classifyWhatsApp({ phone: '+442039896001', whatsapp_listing: '+442039896001' }).status, WA.LINK_LISTING);
    assert.equal(classifyWhatsApp({ phone: '+442039896001', whatsapp_mentioned: true }).status, WA.MENTIONED);
    assert.equal(classifyWhatsApp({ phone: '+447958131295' }).status, WA.MOBILE);
    assert.equal(classifyWhatsApp({ phone: '+442039896001' }).status, WA.LANDLINE);
    assert.equal(classifyWhatsApp({ phone: '' }).status, WA.NONE);
    // A WhatsApp number on the site wins over the listing phone, unless they match.
    assert.equal(classifyWhatsApp({ phone: '+442080907307', whatsapp_site_numbers: '+447700900123' }).number, '+447700900123');
    // A hand check always wins.
    assert.equal(classifyWhatsApp({ phone: '+442039896001', whatsapp_verified: 'WHATSAPP' }).priority, 1);
    assert.equal(classifyWhatsApp({ phone: '+447958131295', whatsapp_verified: 'no' }).priority, 4);
});

test('the chat link opens WhatsApp with the intro typed in', () => {
    assert.equal(whatsappLink('+44 7958 131295'), 'https://wa.me/447958131295');
    const link = whatsappLink('+447958131295', 'Hello there');
    assert.equal(link, 'https://wa.me/447958131295?text=Hello%20there');
    assert.match(loadWhatsAppTemplate(), /Jaffa Glass/);
});

test('WhatsApp shops are listed first among the targets', () => {
    const rows = prepareLeads([
        { business_name: 'Landline Judaica', phone: '+442080000001', relevance_tier: 'Judaica seller', relevance_score: 90 },
        { business_name: 'No Phone Judaica', phone: '', relevance_tier: 'Judaica seller', relevance_score: 95 },
        { business_name: 'Mobile Kosher', phone: '+447700900001', relevance_tier: 'Jewish / Israeli retail', relevance_score: 20 },
        { business_name: 'Linked Judaica', phone: '+442080000002', whatsapp_site_numbers: '+442080000002', relevance_tier: 'Judaica seller', relevance_score: 40 },
        { business_name: 'Unrelated Mobile', phone: '+447700900002', relevance_tier: 'Unrelated', relevance_score: 1 },
    ], { sender: { name: 'Dana' } });
    assert.deepEqual(rows.map(r => r.business_name),
        ['Linked Judaica', 'Mobile Kosher', 'Landline Judaica', 'No Phone Judaica', 'Unrelated Mobile']);
    const linked = rows[0];
    assert.equal(linked.whatsapp_status, WA.LINK_SITE);
    assert.match(linked.whatsapp_link, /^https:\/\/wa\.me\/442080000002\?text=/);
    assert.match(decodeURIComponent(linked.whatsapp_link), /This is Dana from Jaffa Glass/);
    assert.match(decodeURIComponent(linked.whatsapp_link), /noticed that Linked Judaica also offers Judaica/);
    assert.equal(rows.find(r => r.business_name === 'No Phone Judaica').whatsapp_link, '');
});

test('end to end: the contact lookup records a WhatsApp button on the shop site', async (t) => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html><body><h1>Judaica Rosiers</h1><a href="mailto:contact@judaica-rosiers.fr">Mail</a>'
            + '<a class="whatsapp-button" href="https://wa.me/33612345678">WhatsApp</a></body></html>');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    t.after(() => server.close());
    const enricher = new ContactEnricher({
        http: createHttpClient({ transport: 'local' }),
        config: { delayMs: 0, phoneCode: '33', guessImpressum: false }, log: () => {},
    });
    const lead = { business_name: 'Judaica Rosiers', website: `http://127.0.0.1:${server.address().port}/`, phone: '+33142345678' };
    await enricher.enqueue(lead);
    assert.equal(lead.whatsapp_site_numbers, '+33612345678');
    assert.equal(classifyWhatsApp(lead).status, WA.LINK_SITE);
    assert.equal(classifyWhatsApp(lead).number, '+33612345678', 'the WhatsApp number, not the landline');
});

test('full Israel sushi run: a wa.me link without its country code is a local number', async () => {
    const { extractWhatsApp, fixMissingCode } = await import('../src/whatsapp.js');
    // "סושי טיים" linked wa.me/527320122 and came back as +527320122.
    assert.deepEqual(extractWhatsApp('<a href="https://wa.me/527320122">x</a>', '972').numbers, ['+972527320122']);
    assert.equal(fixMissingCode('+527320122', '972'), '+972527320122');
    // Real international numbers are left alone.
    assert.equal(fixMissingCode('+447958131295', '972'), '+447958131295');
    // A US number that can't be a German mobile (015–017 …) stays American.
    assert.equal(fixMissingCode('+12125551234', '49'), '+12125551234');
    assert.equal(fixMissingCode('+972527320122', '972'), '+972527320122');
});

test('full Israel sushi run: the WhatsApp sheet has one row per number', async () => {
    const { uniqueByWhatsApp } = await import('../src/output.js');
    const rows = [
        { business_name: 'Atza Sushi Bar Ashdod', whatsapp_number: '+972502975776' },
        { business_name: 'Moon Sushi', whatsapp_number: '+972552217817' },
        { business_name: 'Atza Sushi Bar Mevaseret', whatsapp_number: '+972502975776' },
        { business_name: 'No number', whatsapp_number: '' },
    ];
    assert.deepEqual(uniqueByWhatsApp(rows).map(r => r.business_name), ['Atza Sushi Bar Ashdod', 'Moon Sushi', 'No number']);
});

test('full sushi runs: the trunk 0 kept after the code, and a German mobile without 49, are repaired', async () => {
    const { fixMissingCode, extractWhatsApp } = await import('../src/whatsapp.js');
    const cases = [
        ['+9720587654774', '972', '+972587654774'],     // "+972 058…"
        ['+972098788888', '972', '+97298788888'],
        ['+49021136113699', '49', '+4921136113699'],    // "+49 0211…"
        ['+15730642210', '49', '+4915730642210'],       // wa.me/15730642210 on a German site: 01573 …, not +1 573
        ['+779800472', '972', '+972779800472'],         // 077-980-0472
        ['+27689485996', '972', '+27689485996'],        // a real South African number stays
        ['+962779221888', '972', '+962779221888'],
        ['+390212345678', '39', '+390212345678'],       // Italy keeps its 0
    ];
    for (const [n, code, want] of cases) assert.equal(fixMissingCode(n, code), want, n);
    assert.deepEqual(extractWhatsApp('<p>WhatsApp: +972 058-765-4774</p>', '972').numbers, ['+972587654774']);
});

test('full Israel sushi run: Ramallah and Amman are outside Israel; Hebron Road in Jerusalem is not', async () => {
    const { resolveCountry } = await import('../src/config.js');
    const { foreign } = resolveCountry({ country: 'IL', campaign: 'sushi' });
    assert.ok(foreign.test('Irsal Street, Ramallah Albereh'));
    assert.ok(foreign.test('Jordan, Amman, Queen Rania St, JOMajdi Mall'));
    assert.ok(!foreign.test('Derech Hebron 1, Jerusalem'));
    assert.ok(!foreign.test("8c, Sokolov St, Ra'anana, 4333419"));
    // A +970 (Palestinian Authority) number on an address that reads "Jerusalem".
    const { foreignPhone } = resolveCountry({ country: 'IL', campaign: 'sushi' });
    assert.ok(foreignPhone.test('+97022440696'));
    assert.ok(!foreignPhone.test('+97222440696'));
});
