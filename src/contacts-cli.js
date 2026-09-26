/**
 * Re-run the website / Impressum lookup without re-scraping Maps.
 *
 *   npm run contacts -- output/leads.json          refresh every row, rewrite output/
 *   npm run contacts -- --probe https://shop.de "Shop Name"   check one website and print what it finds
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ContactEnricher, greetingFor } from './contacts.js';
import { createHttpClient } from './http.js';
import { createSaver } from './output.js';
import { relevanceFields } from './maps.js';
import { loadInput } from './config.js';
import { loadTemplate, DEFAULT_TEMPLATE_PATH } from './email-template.js';
import { TARGET_TIERS } from './relevance.js';

const probeAt = process.argv.indexOf('--probe');

async function probe(url, name) {
    const http = createHttpClient({ transport: 'local' });
    const enricher = new ContactEnricher({ http, config: { delayMs: 0 } });
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
    const leads = JSON.parse(fs.readFileSync(file, 'utf8'));
    const http = createHttpClient({ transport: 'local' });
    const enricher = new ContactEnricher({ http, config: input.contacts || {} });
    let done = 0;
    await Promise.all(leads.map(l => enricher.enqueue(l).then(() => {
        Object.assign(l, relevanceFields(l, l._siteText));
        console.log(`[${++done}/${leads.length}] ${l.business_name}: ${l.email || 'no email'}${l.contact_name ? ' · ' + l.contact_name : ''}`);
    })));
    const save = createSaver(path.resolve(input.outputDir || 'output'), {
        template: loadTemplate(input.emailTemplate || DEFAULT_TEMPLATE_PATH),
        sender: input.sender || {},
        includeTiers: input.includeTiers || TARGET_TIERS.slice(0, 2),
    });
    await save(leads);
}

if (probeAt !== -1 && process.argv[probeAt + 1]) {
    await probe(process.argv[probeAt + 1], process.argv[probeAt + 2]);
} else if (process.argv[2] && !process.argv[2].startsWith('--') && fs.existsSync(process.argv[2])) {
    await refresh(process.argv[2]);
} else {
    console.log('Usage:\n  npm run contacts -- output/leads.json\n  npm run contacts -- --probe https://example-shop.de');
    process.exitCode = 1;
}
