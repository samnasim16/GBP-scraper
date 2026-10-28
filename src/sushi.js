/**
 * The sushi campaign: which places serve sushi — and so might buy Jaffa
 * Glass's hand-made glass plates and cups?
 *
 * Same idea as the Judaica scoring in relevance.js: every row is scored on
 * the words in its name, Maps category and description, and (once read) its
 * own website, and banded into a tier. "סושי Tel Aviv" also returns
 * supermarkets with a sushi counter, fish shops and burger bars, so the tier,
 * not the search term, decides who gets the email.
 */

import { clean } from './util.js';

/** Tiers, best first. The first two get the email (see CAMPAIGNS in config.js). */
export const SUSHI_TIERS = ['Sushi place', 'Japanese / Asian restaurant', 'Other restaurant', 'Not a restaurant', 'Non-profit / religious'];

/** Sushi words. Matched at a word start: "Sushiya", "סושיה", "הסושי". */
const SUSHI = ['sushi', 'sashimi', 'nigiri', 'omakase', 'uramaki', 'temaki', 'futomaki', 'hosomaki', 'chirashi',
    'סושי', 'סשימי', 'סאשימי', 'ניגירי', 'אומקאסה', 'אוראמאקי', 'טמאקי', 'פוטומאקי', 'הוסומאקי', 'אינסייד אאוט'];
/** …and whole words only: "maki" is also the start of "making". */
const SUSHI_WHOLE = ['maki', 'מאקי'];

/**
 * Japanese and Asian kitchens. In Israel nearly every Asian restaurant has
 * sushi on the menu, so they are the second tier.
 */
const ASIAN = ['japanese', 'japan', 'asian', 'pan-asian', 'izakaya', 'ramen', 'teppanyaki', 'yakitori', 'robata', 'tempura',
    'gyoza', 'udon', 'noodle', 'dim sum', 'chinese', 'thai', 'vietnamese', 'korean', 'nikkei',
    'יפני', 'יפנית', 'אסייתי', 'אסייתית', 'אסיאתי', 'אסיאתית', 'ראמן', 'איזקאיה', 'נודלס', 'סינית', 'תאילנדי', 'תאילנדית',
    'וייטנאמי', 'וייטנאמית', 'קוריאני', 'קוריאנית', 'דים סאם', 'טמפורה', 'גיוזה', 'אודון', 'טפניאקי'];
const ASIAN_WHOLE = ['wok', 'ווק', 'poke', 'poké', 'פוקי', 'bento', 'בנטו', 'סיני'];

/** Places that serve food: restaurants, bars, takeaways, delivery kitchens, caterers. */
const FOOD_SERVICE = /restaurant|takeaway|take-?out|meal delivery|food delivery|caterer|catering|\bbar\b|\bpub\b|bistro|brasserie|caf[eé]|coffee shop|diner|eatery|food court|izakaya|\bdeli\b|grill|lounge|buffet|steakhouse/i;

/**
 * Not a buyer of plates: a supermarket's sushi counter, a fish shop, a
 * sushi-supply wholesaler ("Restaurant supply store"), a cooking school, a
 * mall. These win over a restaurant word in the category…
 */
const NOT_RESTAURANT = /supermarket|grocery|convenience store|fish (store|market)|fishmonger|seafood (market|wholesaler|store)|wholesale|supplier|supply|equipment|distributor|importer|manufacturer|packaging|cooking (school|class)|culinary school|\bschool\b|shopping (mall|cent(er|re))|\bmall\b/i;
/** …and these only when there is none: "Coffee shop" serves food, "Ice cream shop" isn't a restaurant. */
const SHOP = /\bmarket\b|\bstore\b|\bshop\b/i;

const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A matcher for a word list. Hebrew glues up to two prefix letters onto a
 * word (ה, ו, ב, ל, ש, כ: "הסושי", "בסושי"); they are allowed before any word.
 */
function matcher(prefixWords, wholeWords) {
    const start = '(?<![\\p{L}\\p{N}])[והבכלש]{0,2}';
    return new RegExp(`${start}(?:(${prefixWords.map(escape).join('|')})|(${wholeWords.map(escape).join('|')})(?![\\p{L}\\p{N}]))`, 'giu');
}
const SUSHI_RE = matcher(SUSHI, SUSHI_WHOLE);
const ASIAN_RE = matcher(ASIAN, ASIAN_WHOLE);

/** The distinct words found, and how often any of them occurs. */
function find(re, text) {
    const words = new Set();
    let count = 0;
    for (const m of String(text || '').matchAll(re)) {
        words.add((m[1] || m[2]).toLowerCase());
        count++;
    }
    return { words: [...words], count };
}

/**
 * Score one place for the sushi campaign. `sellable` is isSellable(lead)
 * from relevance.js: synagogues and public bodies stay out here too.
 * @returns {{ score:number, tier:string, evidence:string }}
 */
export function scoreSushi(lead, siteText = '', sellable = { ok: true }) {
    const name = clean(lead.business_name);
    const category = clean(lead.category);
    const description = clean(lead.maps_description);
    const site = clean(siteText).slice(0, 200000);

    const sushiName = find(SUSHI_RE, name);
    const sushiCategory = find(SUSHI_RE, category);
    const sushiDescription = find(SUSHI_RE, description);
    const sushiSite = find(SUSHI_RE, site);
    const asianListing = find(ASIAN_RE, [name, category, description].join(' '));
    const sushiListing = sushiName.count + sushiCategory.count + sushiDescription.count > 0;
    const notRestaurant = NOT_RESTAURANT.test(category) || (SHOP.test(category) && !FOOD_SERVICE.test(category));
    const foodService = FOOD_SERVICE.test(category) && !notRestaurant;

    let score = 0;
    if (sushiName.count) score += 40;
    if (sushiCategory.count) score += 30;
    if (sushiDescription.count) score += 10;
    score += Math.min(sushiSite.count, 5) * 6;
    if (asianListing.count) score += 15;
    if (foodService) score += 10;
    // A busy restaurant sets more tables.
    const reviews = Number(lead.review_count) || 0;
    if (reviews >= 300) score += 10;
    else if (reviews >= 50) score += 5;

    let tier;
    if (!sellable.ok) {
        tier = 'Non-profit / religious';
        score = Math.min(score, 10);
    } else if (notRestaurant) {
        tier = 'Not a restaurant';
        score = Math.min(score, 15);
    } else if (sushiListing) {
        tier = 'Sushi place';
    } else if (asianListing.count && sushiSite.count) {
        // An Asian kitchen whose menu has sushi.
        tier = 'Sushi place';
    } else if (asianListing.count) {
        tier = 'Japanese / Asian restaurant';
    } else if (sushiSite.count >= 2 && (foodService || !category)) {
        // A bar or restaurant with a sushi section on its menu. One mention
        // ("salmon, like in sushi") is not a menu.
        tier = 'Sushi place';
    } else if (foodService || !category) {
        tier = 'Other restaurant';
    } else {
        tier = 'Not a restaurant';
    }

    score = Math.max(0, Math.min(100, score));
    const evidence = [...new Set([...sushiName.words, ...sushiCategory.words, ...sushiDescription.words, ...asianListing.words,
        ...sushiSite.words.map(w => `${w} (site)`)])].slice(0, 8).join(', ');
    return { score, tier, evidence };
}
