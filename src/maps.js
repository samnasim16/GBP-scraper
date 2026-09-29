/**
 * Scraping one "search term + German city" query on Google Maps.
 *
 * Two passes: read the results feed in a single DOM sweep to screen candidates
 * cheaply, then open each survivor's detail page. The detail page is the sole
 * authority for website, phone, address, rating and category — feed markup is
 * denser and easier to misattribute between neighbouring cards.
 *
 * Maps is loaded with `hl=en&gl=<country>`: local results, English UI. The in-page
 * extractors in dom-extract.js read English labels ("stars", "reviews"), and
 * one UI language is far easier to keep working than two.
 */

import { sleep, clean, titleCase } from './util.js';
import { extractFeedCards, extractDetail } from './dom-extract.js';
import { isSessionDead } from './browser.js';
import { NON_RETAIL_CATEGORY, scoreRelevance, isSellable } from './relevance.js';

import { COUNTRIES } from './config.js';

/** Results from across the border are not leads for this market. */
const DEFAULT_COUNTRY = { code: 'DE', ...COUNTRIES.DE };

export function mapsSearchUrl(text, gl = 'de') {
    return `https://www.google.com/maps/search/${encodeURIComponent(text)}?hl=en&gl=${gl}`;
}

/** Stable place identifier from a Maps URL, for deduping across queries. */
export function placeKey(mapsUrl) {
    const s = String(mapsUrl || '');
    const m = s.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) || s.match(/!19s([^?&!]+)/);
    return m ? m[1] : '';
}

const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

/**
 * The town a shop is actually in, from its address. The search's city is
 * only where we looked: "Judaica Chelmsford" returned Manchester Judaica
 * (Salford), and the sheet said Chelmsford.
 *   DE  "Fasanenstraße 79, 10623 Berlin"              → Berlin
 *   UK  "5 Bury Old Road, Prestwich, Manchester M25 0FG" → Manchester
 */
export function cityFromAddress(address, countryCode = 'DE') {
    const parts = String(address || '').split(',').map(p => p.trim()).filter(Boolean)
        .filter(p => !/^(germany|deutschland|united kingdom|uk|england)$/i.test(p));
    if (!parts.length) return '';
    if (countryCode === 'UK') {
        for (let i = parts.length - 1; i >= 0; i--) {
            if (!UK_POSTCODE.test(parts[i])) continue;
            const town = parts[i].replace(UK_POSTCODE, '').trim();
            if (town && !/\d/.test(town)) return town;
            // "London, NW11 8HB" — the postcode stands alone after the town.
            if (i > 0 && !/\d/.test(parts[i - 1])) return parts[i - 1];
            return '';
        }
        return '';
    }
    for (let i = parts.length - 1; i >= 0; i--) {
        const m = parts[i].match(/^\d{5}\s+(.+)$/);
        if (m) return m[1].trim();
    }
    return '';
}

/** Name + city key, for listings whose URL carries no place id. */
export function nameKey(name, city) {
    return String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') + '|' + String(city || '').toLowerCase();
}

/**
 * EU visitors are redirected to consent.google.com before Maps loads. Answer
 * it (Reject all is fine — Maps works either way) and carry on, rather than
 * treating it as a block.
 */
export async function passConsent(page, log = () => {}) {
    try {
        const onConsent = /consent\.google\./i.test(page.url() || '');
        const btn = await page.$('button[aria-label*="Reject all" i], button[aria-label*="Accept all" i], button[aria-label*="Alle ablehnen" i], button[aria-label*="Alle akzeptieren" i], form[action*="consent"] button');
        if (!btn) return false;
        await Promise.all([
            onConsent ? page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}) : Promise.resolve(),
            btn.click(),
        ]);
        await sleep(1500);
        log('  🍪 Answered Google cookie consent');
        return true;
    } catch {
        return false;
    }
}

export async function scrapeQuery(page, query, ctx, opts) {
    const { seen, allLeads, log = console.log, onLead } = ctx;
    const country = opts.country || DEFAULT_COUNTRY;
    log(`\n🔍 ${query.text}`);

    try {
        await page.goto(mapsSearchUrl(query.text, country.gl), { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (navErr) {
        if (isSessionDead(navErr)) throw navErr;
        log(`  ⚠️  Could not load Google Maps: ${navErr.message.split('\n')[0]} — skipping`);
        return;
    }

    await passConsent(page, log);
    if (/consent\.google\./i.test(page.url() || '')) {
        // Still on the consent page: try the search once more now it is answered.
        try { await page.goto(mapsSearchUrl(query.text, country.gl), { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch { /* reported below */ }
    }

    const block = await detectBlockPage(page);
    if (block) {
        log(`  🚫 Google served a block page (${block}).`);
        log('     Options: run with "headless": false, slow down delayBetweenQueries,');
        log('     or set BRIGHTDATA_WSS to route through a residential proxy.');
        return;
    }

    let feed = null;
    let single = false;
    for (let attempt = 0; attempt < 5; attempt++) {
        await sleep(2000);
        feed = await page.$('div[role="feed"]');
        if (feed) break;
        if (await page.$('h1.DUwDvf')) { single = true; break; }
    }

    let cards = [];
    if (feed) {
        // Scroll until the feed stops growing or Maps says it has run out.
        let last = -1;
        for (let i = 0; i < opts.maxScrolls; i++) {
            await page.evaluate(el => el.scrollBy(0, 1200), feed);
            await sleep(1000);
            if (await page.$('.HlvSq')) break;
            const n = await page.$$eval('div[role="feed"] a[href*="/maps/place/"]', els => els.length).catch(() => 0);
            if (n === last) break;
            last = n;
        }
        await sleep(1000);
        cards = await page.evaluate(extractFeedCards);
    } else if (single) {
        // A very specific term (e.g. "Judaica Worms") can jump straight to one place.
        cards = [{ name: '', href: page.url(), category: '', rating: null, reviewCount: 0, closedFlag: false }];
        log('  ℹ️  Single result page');
    } else {
        log('  ⚠️  No results (empty or blocked)');
        return;
    }

    const window = cards.slice(0, opts.maxResultsPerQuery);
    const drop = { closed: 0, notRetail: 0, nonProfit: 0, dup: 0, reviews: 0 };
    const survivors = [];
    for (const c of window) {
        if (c.closedFlag) { drop.closed++; continue; }
        const pk = placeKey(c.href);
        const nk = nameKey(c.name, query.city);
        if ((pk && seen.has(pk)) || (c.name && seen.has(nk))) { drop.dup++; continue; }
        // Synagogues, communities, e.V.s, schools, museums: nobody to sell to.
        if (!opts.keepNonProfits && !isSellable({ business_name: c.name, category: c.category }).ok) {
            drop.nonProfit++; continue;
        }
        // Cheap pre-screen: a kosher restaurant is not a buyer. Only drop when
        // the name carries no Judaica word at all.
        if (c.category && NON_RETAIL_CATEGORY.test(c.category) && scoreRelevance({ business_name: c.name }).tier !== 'Judaica seller') {
            drop.notRetail++; continue;
        }
        if (opts.minReviews > 0 && c.reviewCount > 0 && c.reviewCount < opts.minReviews) { drop.reviews++; continue; }
        survivors.push({ ...c, pk, nk });
    }
    log(`  Feed: ${cards.length} places | new: ${survivors.length} | dropped — dup:${drop.dup} non-profit:${drop.nonProfit} not-retail:${drop.notRetail} closed:${drop.closed}${drop.reviews ? ` reviews:${drop.reviews}` : ''}`);

    for (const c of survivors) {
        if (allLeads.length >= opts.maxLeads) return;
        try {
            if (!single) {
                let opened = false;
                for (let attempt = 1; attempt <= 2; attempt++) {
                    try {
                        const url = c.href + (c.href.includes('?') ? '&' : '?') + `hl=en&gl=${country.gl}`;
                        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
                        opened = true;
                        break;
                    } catch (e) {
                        if (isSessionDead(e)) throw e;
                        if (await page.$('h1.DUwDvf')) { opened = true; break; }
                        if (attempt < 2) await sleep(2500);
                    }
                }
                if (!opened) { log(`    ⚠️  Could not load ${c.name} — skipping`); continue; }
                await sleep(opts.delayBetweenListings);
            }
            try { await page.waitForSelector('h1.DUwDvf', { timeout: 8000 }); } catch { /* panel may render late */ }

            const d = await page.evaluate(extractDetail, country.phoneCode);
            const name = clean(d.name) || c.name;
            if (!name) continue;
            const address = clean(d.address);
            if (country.foreign.test(address)) { log(`    ✗ Outside ${country.name}: ${name} (${address})`); continue; }

            const pk = c.pk || placeKey(page.url());
            const nk = nameKey(name, query.city);
            // The same place comes back from searches in many towns; key it by
            // the town in its address too, so it is kept once.
            const addrCity = cityFromAddress(address, country.code);
            const ak = addrCity ? nameKey(name, addrCity) : '';
            if ((pk && seen.has(pk)) || seen.has(nk) || (ak && seen.has(ak))) continue;
            if (d.phone && seen.has(d.phone)) continue;
            if (pk) seen.add(pk);
            seen.add(nk);
            if (ak) seen.add(ak);
            if (d.phone) seen.add(d.phone);

            const rating = d.rating ?? c.rating ?? null;
            const lead = {
                business_name:      name,
                relevance_tier:     '',
                relevance_score:    0,
                relevance_evidence: '',
                email:              clean(d.email),
                other_emails:       '',
                contact_name:       '',
                contact_role:       '',
                greeting:           '',
                phone:              d.phone || '',
                website:            d.websiteUrl || '',
                city:               addrCity || query.city.replace(/^.*,\s*/, ''),
                bundesland:         query.state,
                address:            address,
                category:           titleCase(clean(d.category) || clean(c.category)),
                rating:             rating ?? '',
                review_count:       d.reviews || c.reviewCount || 0,
                facebook_url:       '',
                instagram_url:      '',
                maps_description:   clean(d.description),
                hours_summary:      clean(d.hoursSummary),
                maps_url:           c.href || page.url(),
                source_query:       query.text,
                country:            country.code,
                observed_date:      new Date().toISOString().split('T')[0],
            };
            // The feed card may have had no category; the detail page does.
            const sellable = isSellable(lead);
            if (!sellable.ok && !opts.keepNonProfits) {
                log(`    ✗ Can't sell to: ${lead.business_name} — ${sellable.reason}`);
                continue;
            }
            // Listing-only score now; it is rescored once the website is read.
            Object.assign(lead, relevanceFields(lead));

            allLeads.push(lead);
            log(`    ✅ ${lead.business_name} | ${lead.category || '?'} | ${lead.website ? 'website' : 'no website'} | ${lead.relevance_tier}`);
            if (typeof onLead === 'function') onLead(lead);
        } catch (err) {
            if (isSessionDead(err)) throw err;
            log(`    ⚠️  Error on ${c.name}: ${err.message}`);
        }
    }
}

export function relevanceFields(lead, siteText = '') {
    const r = scoreRelevance(lead, siteText);
    return { relevance_tier: r.tier, relevance_score: r.score, relevance_evidence: r.evidence };
}

/**
 * Recognise Google's "unusual traffic" / captcha interstitial.
 * @returns {Promise<string|null>} a short reason, or null when the page is fine.
 */
export async function detectBlockPage(page) {
    try {
        const url = page.url() || '';
        if (/\/sorry\//i.test(url)) return 'redirected to ' + url.slice(0, 60);
        return await page.evaluate(() => {
            const text = (document.body && document.body.innerText || '').slice(0, 3000);
            if (/unusual traffic from your computer network/i.test(text)) return 'unusual traffic notice';
            if (/detected unusual traffic|ungewöhnlichen Datenverkehr/i.test(text)) return 'unusual traffic notice';
            if (/I'm not a robot|recaptcha|Ich bin kein Roboter/i.test(text)) return 'captcha challenge';
            if (/Our systems have detected/i.test(text)) return 'automated query notice';
            return null;
        });
    } catch {
        return null;
    }
}
