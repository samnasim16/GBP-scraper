/**
 * How likely is a business to sell Judaica — and so to want Jaffa Glass?
 *
 * Maps search is fuzzy: "koscher Laden" returns kosher restaurants, "Glaskunst"
 * returns glaziers, "Judaica" returns synagogues and cemeteries. So every row
 * is scored on the words that actually appear in its name, category, Maps
 * description and (after enrichment) its own website, and banded into a tier.
 * The tier, not the search term that found it, decides whether it is a target.
 */

import { clean } from './util.js';

/** Strong signals — words a shop only uses if it sells Jewish ritual objects. */
const JUDAICA_STRONG = [
    'judaica', 'judaika', 'menora', 'menorah', 'chanukkia', 'chanukia', 'hanukkia', 'chanukka-leuchter',
    'mesusa', 'mezuzah', 'mezuza', 'kidduschbecher', 'kiddusch-becher', 'kiddush cup', 'kiddusch',
    'sederteller', 'seder plate', 'sederplate', 'tallit', 'tallis', 'tefillin', 'kippa', 'kippot', 'kipa',
    'schabbatleuchter', 'shabbat candle', 'challa', 'challah', 'hawdala', 'havdalah', 'davidstern',
    'magen david', 'star of david', 'jüdische kunst', 'jewish art', 'jüdische ritualgegenstände',
];

/** Medium signals — Jewish/Israeli context, but not necessarily a shop. */
const JEWISH_CONTEXT = [
    'jüdisch', 'juedisch', 'jewish', 'israel', 'israeli', 'hebräisch', 'hebraisch', 'hebrew',
    'koscher', 'kosher', 'schabbat', 'shabbat', 'chanukka', 'hanukkah', 'pessach', 'passover',
    'rosch haschana', 'rosh hashana', 'jerusalem', 'tel aviv', 'jaffa', 'synagoge', 'synagogue',
    'jüdische gemeinde', 'chabad', 'tora', 'torah', 'jiddisch', 'yiddish',
];

/** Retail signals — they sell things to the public. */
const RETAIL = [
    'shop', 'laden', 'geschäft', 'geschenk', 'gift', 'boutique', 'buchhandlung', 'buchladen',
    'bookstore', 'museumsshop', 'museum shop', 'store', 'handel', 'versand', 'onlineshop',
    'online-shop', 'kaufen', 'galerie', 'gallery', 'kunsthandwerk', 'souvenir', 'supermarkt', 'markt',
];

/** Glass & finish — Jaffa Glass's own product language. */
const GLASS = ['glas', 'glass', 'kristall', 'crystal', 'blattgold', 'gold leaf', 'mundgeblasen', 'hand-blown', 'handblown'];

/**
 * Categories that are never a buyer, however Jewish the context: a restaurant
 * serving kosher food, a cemetery, a school. Checked against the Maps category.
 */
export const NON_RETAIL_CATEGORY = /\b(restaurant|imbiss|caf[eé]|bistro|bar|hotel|pension|hostel|friedhof|cemetery|schule|school|kindergarten|kita|rechtsanwalt|anwalt|lawyer|arzt|doctor|praxis|clinic|klinik|botschaft|embassy|konsulat|consulate|reisebüro|travel agency|glaserei|glazier|fensterbau|window|autoglas|immobilien|real estate|parkplatz|parking|denkmal|memorial|gedenkstätte|haltestelle|bus stop|station)\b/i;

/** Places of worship and communities — not a shop, but some run one. */
export const COMMUNITY_CATEGORY = /\b(synagog\w*|jüdische gemeinde|jewish community|gemeindezentrum|community cent(er|re)|religious organi[sz]ation|chabad)\b/i;

const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternCache = new Map();

/**
 * Words match at a word START only: German compounds put the meaningful word
 * last ("Judaica-Geschenke" is fine, but so is "Restaurierung" containing
 * "tora"), so a bare substring test finds Torah in every restoration workshop.
 * Glass is the exception — "Kunstglas", "Bleiglas" — and opts into `anywhere`.
 */
function countHits(hay, words, { anywhere = false } = {}) {
    const hits = [];
    for (const w of words) {
        const key = w + (anywhere ? '*' : '');
        let re = patternCache.get(key);
        if (!re) {
            re = new RegExp((anywhere ? '' : '(?<![\\p{L}\\p{N}])') + escape(w), 'iu');
            patternCache.set(key, re);
        }
        if (re.test(hay)) hits.push(w);
    }
    return hits;
}

/**
 * Score one lead. `siteText` is the visible text of its website, if fetched.
 * @returns {{ score:number, tier:string, evidence:string }}
 */
export function scoreRelevance(lead, siteText = '') {
    const listing = clean([lead.business_name, lead.category, lead.maps_description].join(' ')).toLowerCase();
    const site = clean(siteText).toLowerCase().slice(0, 200000);

    const strongListing = countHits(listing, JUDAICA_STRONG);
    const strongSite = countHits(site, JUDAICA_STRONG);
    const contextListing = countHits(listing, JEWISH_CONTEXT);
    const contextSite = countHits(site, JEWISH_CONTEXT);
    const retail = countHits(listing + ' ' + site, RETAIL);
    const glass = countHits(listing + ' ' + site, GLASS, { anywhere: true });

    let score = 0;
    score += Math.min(strongListing.length, 2) * 30;
    score += Math.min(strongSite.length, 4) * 10;
    score += Math.min(contextListing.length, 2) * 12;
    score += Math.min(contextSite.length, 3) * 4;
    if (retail.length) score += 10;
    if (glass.length) score += 5;

    const category = clean(lead.category);
    let tier;
    if (NON_RETAIL_CATEGORY.test(category) && strongListing.length === 0) {
        tier = 'Not a retailer';
        score = Math.min(score, 15);
    } else if (COMMUNITY_CATEGORY.test(category) || (COMMUNITY_CATEGORY.test(lead.business_name || '') && strongListing.length === 0 && retail.length === 0)) {
        tier = 'Community / synagogue';
        score = Math.min(score, 45);
    } else if (strongListing.length || strongSite.length >= 2) {
        tier = 'Judaica seller';
    } else if ((contextListing.length || contextSite.length >= 2) && retail.length) {
        tier = 'Jewish / Israeli retail';
    } else if (glass.length && retail.length) {
        tier = 'Glass & gift shop';
    } else {
        tier = 'Unrelated';
    }

    score = Math.max(0, Math.min(100, score));
    const evidence = [...new Set([...strongListing, ...strongSite, ...contextListing, ...contextSite])].slice(0, 8).join(', ');
    return { score, tier, evidence };
}

/** Tiers worth emailing, best first. */
export const TARGET_TIERS = ['Judaica seller', 'Jewish / Israeli retail', 'Glass & gift shop', 'Community / synagogue'];

/**
 * Should this row go on the outreach sheet?
 * `includeTiers` comes from config; by default gift shops that merely sell
 * glass are included only when their site mentions Jewish/Israeli context.
 */
export function isTarget(lead, includeTiers = TARGET_TIERS.slice(0, 2)) {
    return includeTiers.includes(lead.relevance_tier);
}
