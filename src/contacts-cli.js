/**
 * Re-run the website / Impressum lookup without re-scraping Maps.
 *
 *   npm run contacts -- output/leads.json          refresh every row, rewrite output/
 *   npm run contacts -- output-uk/leads.json --input input.england.json
 *   npm run contacts -- --probe https://shop.de "Shop Name"   check one website and print what it finds
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ContactEnricher, greetingFor } from './contacts.js';
import { createHttpClient } from './http.js';
import { createSaver } from './output.js';
import { relevanceFields } from './maps.js';
import { loadInput, resolveCountry } from './config.js';
import { loadTemplate, DEFAULT_TEMPLATE_PATH } from './email-template.js';
import { TARGET_TIERS, isSellable } from './relevance.js';

const probeAt = process.argv.indexOf('--probe');

/** The contact-page conventions of the configured country (Impressum vs Contact). */
function countryContacts(input) {
    const c = resolveCountry(input);
    return { acceptLanguage: c.acceptLanguage, phoneCode: c.phoneCode, keyPage: c.contactKeyPage, guessPaths: c.contactPaths };
}

async function probe(url, name) {
    const http = createHttpClient({ transport: 'local' });
    const enricher = new ContactEnricher({ http, config: { ...countryContacts(loadInput(() => {})), delayMs: 0 } });
    const lead = { business_name: name || new URL(url).hostname, website: url };
    await enricher.enrich(lead);
    Object.assign(lead, relevanceFields(lead, lead._siteText));
    console.log(JSON.stringify({
        email: lead.email, other_emails: lead.other_emails,
        contact_name: lead.contact_name, contact_role: lead.contact_role,
        greeting: greetingFor(lead),
        facebook: lead.facebook_url, instagram: lead.instagram_url,
        relevance: `${lead.relevance_tier} (${lead.relevance_score}) — ${lead.relevance_evidence}`,
        pages_fetched: enricher.stats.pages,
    }, null, 2));
}

async function refresh(file) {
    const input = loadInput(() => {});
    // Rows scraped before a filter existed are held to today's rules, and
    // organisations we cannot sell to are not re-crawled at all.
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    const leads = input.keepNonProfits ? all : all.filter(l => isSellable(l).ok);
    if (leads.length < all.length) console.log(`Skipping ${all.length - leads.length} non-profit / public / religious rows`);
    const http = createHttpClient({ transport: 'local' });
    const enricher = new ContactEnricher({ http, config: { ...countryContacts(input), ...(input.contacts || {}) } });
    let done = 0;
    await Promise.all(leads.map(l => enricher.enqueue(l).then(() => {
        Object.assign(l, relevanceFields(l, l._siteText));
        console.log(`[${++done}/${leads.length}] ${l.business_name}: ${l.email || 'no email'}${l.contact_name ? ' · ' + l.contact_name : ''}`);
    })));
    const save = createSaver(path.resolve(input.outputDir || resolveCountry(input).outputDir), {
        template: loadTemplate(input.emailTemplate || DEFAULT_TEMPLATE_PATH),
        sender: input.sender || {},
        includeTiers: input.includeTiers || TARGET_TIERS.slice(0, 2),
    });
    await save(leads);
}

if (probeAt !== -1 && process.argv[probeAt + 1]) {
    const nm = process.argv[probeAt + 2];
    await probe(process.argv[probeAt + 1], nm && !nm.startsWith('--') ? nm : undefined);
} else if (process.argv[2] && !process.argv[2].startsWith('--') && fs.existsSync(process.argv[2])) {
    await refresh(process.argv[2]);
} else {
    console.log('Usage:\n  npm run contacts -- output/leads.json\n  npm run contacts -- --probe https://example-shop.de');
    process.exitCode = 1;
}
