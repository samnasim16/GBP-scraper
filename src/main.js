/**
 * GERMAN JUDAICA RETAILER SCRAPER — for Jaffa Glass outreach
 *
 * Searches Google Maps across Germany for shops that sell Judaica (and the
 * Jewish / Israeli gift, book and museum shops around them), reads each shop's
 * website and Impressum for an email address and the owner's name, scores how
 * likely it is to stock Judaica, and writes:
 *
 *   output/judaica-leads.xlsx   Outreach · No email found · All results
 *   output/mail-merge.csv       To / Greeting / Subject / Body, ready to send
 *
 * Runs on this machine with your own Chrome. No accounts, no per-lead cost.
 *
 * Run:  npm start               (reads ./input.json, writes ./output/)
 */

import path from 'node:path';
import process from 'node:process';

import { loadDotEnv, loadInput, resolveLocations, buildQueryMatrix, resolveCountry } from './config.js';
import { createBrowserFactory, isSessionDead } from './browser.js';
import { createSaver, prepareLeads } from './output.js';
import { scrapeQuery, relevanceFields } from './maps.js';
import { ContactEnricher } from './contacts.js';
import { createHttpClient } from './http.js';
import { loadTemplate, DEFAULT_TEMPLATE_PATH } from './email-template.js';
import { isTarget, TARGET_TIERS } from './relevance.js';
import { sleep } from './util.js';

loadDotEnv();

const input = loadInput();
const {
    browserWSEndpoint,
    browser: browserConfig = {},
    searchCategories     = [],
    minReviews           = 0,
    maxResultsPerQuery   = 60,
    maxScrolls           = 12,
    maxLeads             = 5000,
    delayBetweenQueries  = 4000,
    delayBetweenListings = 1800,
    keepNonProfits       = false,
    contacts             = {},
    includeTiers         = TARGET_TIERS.slice(0, 2),
    sender               = {},
    emailTemplate        = DEFAULT_TEMPLATE_PATH,
} = input;

const COUNTRY = resolveCountry(input);
// Each market writes to its own folder, so an England run never overwrites
// the Germany results.
const OUTPUT_DIR = path.resolve(process.cwd(), input.outputDir || COUNTRY.outputDir);
const template = loadTemplate(emailTemplate);
const saveResults = createSaver(OUTPUT_DIR, { template, sender, includeTiers });

// ─── CRASH SAFETY NET ─────────────────────────────────────────────────────
let LEADS_REF = [];
process.on('unhandledRejection', (reason) => {
    console.error(`   ⚠️  Unhandled rejection (continuing): ${reason && reason.message ? reason.message : reason}`);
    saveResults(LEADS_REF, { quiet: true }).catch(() => {});
});
process.on('uncaughtException', (err) => {
    console.error(`   ⚠️  Uncaught exception (continuing): ${err && err.message ? err.message : err}`);
    saveResults(LEADS_REF, { quiet: true }).catch(() => {});
});
let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n   🛑 ${sig} received — flushing results before exit...`);
        await saveResults(LEADS_REF);
        process.exit(0);
    });
}

const wssEndpoint = (process.env.BRIGHTDATA_WSS || browserWSEndpoint || '').trim();
const LOCATIONS = resolveLocations(input);
const CATEGORIES = (Array.isArray(searchCategories) && searchCategories.length > 0)
    ? searchCategories.map(c => String(c).trim()).filter(Boolean)
    : COUNTRY.categories;

async function main() {
    const allLeads = [];
    LEADS_REF = allLeads;
    const seen = new Set();
    let session = null;
    let factory = null;

    if (!sender.name) {
        console.log('ℹ️  No "sender" in input.json — emails will say [Your Name] / [Title]. Add');
        console.log('    "sender": { "name": "…", "title": "…" } to fill them in.\n');
    }

    // Shop websites answer plain HTTP almost always; the browser is only a
    // fallback for the few behind a bot wall.
    const http = createHttpClient({
        transport: contacts.transport || 'auto',
        getBrowser: () => (session ? session.browser : null),
        timeoutMs: 20000,
    });
    const enricher = new ContactEnricher({
        http,
        config: {
            acceptLanguage: COUNTRY.acceptLanguage,
            keyPage: COUNTRY.contactKeyPage,
            guessPaths: COUNTRY.contactPaths,
            ...contacts,
        },
        log: console.log,
        onDone: (lead) => {
            Object.assign(lead, relevanceFields(lead, lead._siteText));
            const bits = [lead.email || 'no email', lead.contact_name || null].filter(Boolean).join(' · ');
            console.log(`    📇 ${lead.business_name}: ${bits} — ${lead.relevance_tier}`);
        },
    });

    try {
        console.log(`🚀 Judaica Retailer Scraper — ${COUNTRY.name} — Jaffa Glass`);
        factory = await createBrowserFactory({ config: browserConfig, wssEndpoint, log: console.log });
        const queries = buildQueryMatrix(LOCATIONS, CATEGORIES, COUNTRY.highYield);
        console.log(`   ${CATEGORIES.length} search terms × ${LOCATIONS.length} locations = ${queries.length} queries`);
        console.log(`   Contact lookup: ${enricher.enabled ? 'on (website + contact/Impressum pages)' : 'off'}`);
        console.log(`   Output: ${OUTPUT_DIR}`);
        console.log(`   Outreach tiers: ${includeTiers.join(', ')}\n`);

        const opts = { maxResultsPerQuery, maxScrolls, minReviews, maxLeads, delayBetweenListings, keepNonProfits, country: COUNTRY };
        const REFRESH_EVERY = factory.mode === 'brightdata' ? 15 : 40;
        const SAVE_EVERY = 10;

        session = await factory.open();
        let consecutiveFailures = 0;
        let lastSavedCount = 0;

        const ctx = {
            seen, allLeads,
            log: console.log,
            onLead: (lead) => { enricher.enqueue(lead).catch(() => {}); },
        };

        for (let qi = 0; qi < queries.length; qi++) {
            if (allLeads.length >= maxLeads) break;

            if (qi > 0 && qi % REFRESH_EVERY === 0) {
                console.log(`\n🔄 Refreshing browser session (every ${REFRESH_EVERY} queries)...`);
                try {
                    session = await factory.refresh(session);
                    await sleep(1500);
                } catch (refreshErr) {
                    console.error(`  ⚠️  Refresh failed (${refreshErr.message}) — reopening...`);
                    try {
                        await factory.close(session);
                        await sleep(4000);
                        session = await factory.open();
                    } catch (again) {
                        console.error(`  ❌ Reopen failed (${again.message}) — will try again next cycle.`);
                    }
                }
            }

            console.log(`[${qi + 1}/${queries.length}] Places so far: ${allLeads.length}`);
            try {
                await scrapeQuery(session.page, queries[qi], ctx, opts);
                consecutiveFailures = 0;
            } catch (err) {
                console.error(`  ❌ Query failed: ${err.message}`);
                consecutiveFailures++;
                const dead = isSessionDead(err);
                if (dead || consecutiveFailures >= 3) {
                    console.log(dead ? '  🔄 Browser session lost — reopening...' : '  🔄 Multiple failures — forcing a fresh session...');
                    try {
                        await factory.close(session);
                        session = await factory.open();
                        consecutiveFailures = 0;
                        await sleep(2000);
                    } catch (reopenErr) {
                        console.error('  ❌ Reopen failed:', reopenErr.message);
                    }
                } else {
                    try { await session.page.goto('about:blank'); await sleep(1500); } catch { /* ignore */ }
                }
            }

            if (allLeads.length - lastSavedCount >= SAVE_EVERY) {
                await saveResults(allLeads);
                lastSavedCount = allLeads.length;
            }
            await sleep(delayBetweenQueries);
        }

        if (enricher.enabled) {
            console.log('\n⏳ Finishing website / Impressum lookups...');
            await enricher.drain();
        }
    } finally {
        if (factory && session) await factory.close(session);
        session = null;
    }

    await saveResults(allLeads);
    const rows = prepareLeads(allLeads);
    const targets = rows.filter(r => isTarget(r, includeTiers));
    const byTier = (t) => rows.filter(r => r.relevance_tier === t).length;

    console.log('\n📊 DONE');
    console.log(`   Places scraped: ${rows.length}`);
    for (const t of [...TARGET_TIERS, 'Unrelated', 'Not a retailer', 'Non-profit / religious']) console.log(`     ${t}: ${byTier(t)}`);
    console.log(`   Outreach targets: ${targets.length} — ${targets.filter(r => r.email).length} with email, ${targets.filter(r => r.contact_name).length} with a named contact`);
    const s = enricher.stats;
    console.log(`   Websites read: ${s.sites} (${s.pages} pages)`);
    console.log(`\n📥 Ready — ${path.relative(process.cwd(), OUTPUT_DIR)}/judaica-leads.xlsx and mail-merge.csv`);
    process.exit(0);
}

main().catch(async (err) => {
    console.error(`💥 Fatal error: ${err && err.message ? err.message : err}`);
    try { await saveResults(LEADS_REF); } catch { /* nothing more we can do */ }
    process.exit(1);
});
