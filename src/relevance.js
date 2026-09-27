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
    'hanukkiah', 'hanukiah', 'chanukiah', 'kiddush', 'yarmulke', 'kippah', 'jewish gift', 'shabbat candlestick',
];

/** Medium signals — Jewish/Israeli context, but not necessarily a shop. */
const JEWISH_CONTEXT = [
    'jüdisch', 'juedisch', 'jewish', 'israel', 'israeli', 'hebräisch', 'hebraisch', 'hebrew',
    'koscher', 'kosher', 'schabbat', 'shabbat', 'chanukka', 'hanukkah', 'pessach', 'passover',
    'rosch haschana', 'rosh hashana', 'jerusalem', 'tel aviv', 'jaffa', 'synagoge', 'synagogue',
    'jüdische gemeinde', 'chabad', 'tora', 'torah', 'jiddisch', 'yiddish', 'judaism', 'sabbath', 'lubavitch',
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
 * serving kosher food, a glazier, a lawyer. Checked against the Maps category.
 */
export const NON_RETAIL_CATEGORY = /\b(restaurant|imbiss|caf[eé]|bistro|bar|hotel|pension|hostel|rechtsanwalt|anwalt|lawyer|attorney|arzt|doctor|praxis|clinic|klinik|reisebüro|travel agency|glaserei|glazier|fensterbau|window|autoglas|immobilien|real estate|parkplatz|parking|haltestelle|bus stop|station|caterer|catering|bakery|bäckerei|butcher|metzgerei|solicitor|takeaway|dentist|estate agent|funeral|undertaker|bestatter|removals?|plumber|electrician|accountant|steuerberater)\b/i;

/**
 * Organisations we cannot sell to: places of worship, communities, charities,
 * foundations, schools, libraries, museums, institutes, public bodies. They
 * buy nothing wholesale, so they are dropped before any time is spent on them.
 * Matched against the Maps category…
 */
export const NON_PROFIT_CATEGORY = /\b(synagog\w*|religious|place of worship|church|kirche|mosque|moschee|temple|chabad|non-?profit|charity|foundation|stiftung|association|verein|society|community|gemeinde|cultural cent(er|re)|kulturzentrum|research|institut\w*|university|universität|college|hochschule|school|schule|gymnasium|kindergarten|kita|preschool|daycare|library|bibliothek|archive|archiv|museum|memorial|gedenkstätte|monument|denkmal|cemetery|friedhof|embassy|botschaft|consulate|konsulat|government|city hall|rathaus|political|youth|jugend|social services|nursing|hospital|seminary|yeshiva)\b/i;

/** …and against the business name. "e.V." is a registered non-profit. */
export const NON_PROFIT_NAME = /(\be\.\s?v\.|\bsynagog\w*|\bgemeinde\b|\bchabad\b|\bverein\b|\bstiftung\b|\bfoundation\b|\binstitut\w*|\bschule\b|\bschool\b|\bgymnasium\b|\bkita\b|\bkindergarten\b|\buniversit\w*|\bhochschule\b|\bbibliothek\b|\blibrary\b|\bmuseum\b|\bgedenkstätte\b|\bmemorial\b|\bfriedhof\b|\bcemetery\b|\bbotschaft\b|\bembassy\b|\bzentralrat\b|\bgesellschaft für\b|\bdeutsch-israelische\b|\bfreundeskreis\b|\bförderverein\b|\bcommunity\b|\bcongregation\b|\bjugend\b|\bjeschiwa\b|\byeshiva\b|\brabbinat\b|\bkirche\b|\bchurch\b|\bcentrum judaicum\b|\bjüdisches zentrum\b|\bjewish cent(er|re)\b|\bshul\b|\blubavitch\b|\bcharity\b|\bfederation\b|\bcouncil\b|\bjcc\b|\bcollege\b|\bacademy\b|\bnursery\b|\bhebrew congregation\b|\bboard of deputies\b)/i;

/**
 * Categories that say "this is a business that sells things". A retail
 * category overrides a non-profit-sounding name: the Chabad-run
 * "Judaica-Laden" is a Judaica Store, and it buys stock.
 */
export const RETAIL_CATEGORY = /\b(store|shop|boutique|gallery|galerie|market|supermarket|grocery|seller|dealer|wholesaler|händler|laden|geschäft|kiosk|jewel\w*|antique\w*|souvenir|gift|craft|glass|glas|art studio|atelier|manufacturer|importer|exporter|distributor|mail order|versand|bookshop|giftshop|deli|delicatessen)\b/i;

/**
 * Websites and inboxes of public bodies: stadt-koeln.de, speyer.de,
 * stadt-oldenburg.de, *.rlp.de. A city library or municipal gallery is not a
 * customer, even when Maps files it as an "Art Gallery".
 */
const GOV_DOMAIN = /(^|\.)(stadt-[a-z-]+|[a-z-]+-stadt|landkreis-[a-z-]+|kreis-[a-z-]+|lra-[a-z-]+)\.de$|\.(bund|nrw|bayern|rlp|niedersachsen|sachsen|thueringen|hessen|saarland|brandenburg|sachsen-anhalt|schleswig-holstein|mv-regierung|bwl|baden-wuerttemberg)\.de$|\.(gov|nhs|ac|sch|police|parliament)\.uk$/;

const slug = (s) => clean(s).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\s*\(.*\)$/, '').replace(/ am main| im breisgau| am neckar| am rhein| an der .*/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const CITY_ALIASES = { muenchen: ['muenchen', 'munich'], koeln: ['koeln', 'cologne'], 'frankfurt': ['frankfurt'], nuernberg: ['nuernberg', 'nuremberg'] };

/** Is this the website or inbox of a city, district or state government? */
export function isPublicBody(lead) {
    const hosts = [];
    try { hosts.push(new URL(lead.website).hostname.replace(/^www\./, '')); } catch { /* no website */ }
    if (lead.email && lead.email.includes('@')) hosts.push(lead.email.split('@')[1]);
    const city = slug(lead.city);
    const cityHosts = new Set((CITY_ALIASES[city] || [city]).filter(Boolean).map(c => `${c}.de`));
    return hosts.some(h => GOV_DOMAIN.test(h) || cityHosts.has(h));
}

/**
 * Can Jaffa Glass sell to this place at all?
 * @returns {{ ok: boolean, reason: string }}
 */
export function isSellable(lead) {
    const category = clean(lead.category);
    const name = clean(lead.business_name);
    const retailCategory = RETAIL_CATEGORY.test(category);
    // Checked first: a city library called "Germania Judaica" is still the city.
    if (isPublicBody(lead)) return { ok: false, reason: 'public body (city / state website)' };
    if (!retailCategory && NON_PROFIT_CATEGORY.test(category)) {
        // A Judaica name under a wrong category (Maps files some shops as
        // "Public Library") still gets through — unless the name itself says
        // it is an organisation.
        if (countHits(name.toLowerCase(), JUDAICA_STRONG).length && !NON_PROFIT_NAME.test(name)) return { ok: true, reason: '' };
        return { ok: false, reason: `non-profit / religious (${category})` };
    }
    if (!retailCategory && NON_PROFIT_NAME.test(name)) return { ok: false, reason: 'non-profit / religious (name)' };
    return { ok: true, reason: '' };
}

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
    // Retail must show in the LISTING. Every community and institute website
    // has a "Shop" or "Spenden-Shop" link somewhere, which made them retailers.
    const retail = countHits(listing, RETAIL);
    const retailCategory = RETAIL_CATEGORY.test(clean(lead.category));
    const glass = countHits(listing + ' ' + site, GLASS, { anywhere: true });

    let score = 0;
    score += Math.min(strongListing.length, 2) * 30;
    score += Math.min(strongSite.length, 4) * 10;
    score += Math.min(contextListing.length, 2) * 12;
    score += Math.min(contextSite.length, 3) * 4;
    if (retail.length || retailCategory) score += 10;
    if (glass.length) score += 5;

    const category = clean(lead.category);
    const sellable = isSellable(lead);
    const isRetail = retailCategory || retail.length > 0;
    let tier;
    if (!sellable.ok) {
        tier = 'Non-profit / religious';
        score = Math.min(score, 10);
    } else if (NON_RETAIL_CATEGORY.test(category) && strongListing.length === 0) {
        tier = 'Not a retailer';
        score = Math.min(score, 15);
    } else if (strongListing.length || (strongSite.length >= 2 && isRetail)) {
        tier = 'Judaica seller';
    } else if ((contextListing.length || (strongSite.length >= 1 && contextSite.length >= 1)) && isRetail) {
        // Website context alone is not enough: "Israel" appears on any
        // bookshop or gallery site that stocks one Israeli author or artist.
        // It needs the listing itself to be Jewish/Israeli, or a Judaica
        // object named on the site.
        tier = 'Jewish / Israeli retail';
    } else if (glass.length && isRetail) {
        tier = 'Glass & gift shop';
    } else {
        tier = 'Unrelated';
    }

    score = Math.max(0, Math.min(100, score));
    const evidence = [...new Set([...strongListing, ...strongSite, ...contextListing, ...contextSite])].slice(0, 8).join(', ');
    return { score, tier, evidence };
}

/** Tiers worth emailing, best first. */
export const TARGET_TIERS = ['Judaica seller', 'Jewish / Israeli retail', 'Glass & gift shop'];

/**
 * Should this row go on the outreach sheet?
 * `includeTiers` comes from config; by default gift shops that merely sell
 * glass are included only when their site mentions Jewish/Israeli context.
 */
export function isTarget(lead, includeTiers = TARGET_TIERS.slice(0, 2)) {
    return includeTiers.includes(lead.relevance_tier);
}
