/**
 * Does this shop use WhatsApp, and on which number?
 *
 * There is no free, permitted way to ask WhatsApp whether a number is
 * registered — the only check is opening a chat. So this works from evidence,
 * strongest first:
 *
 *   1. a WhatsApp button or link on the shop's website (wa.me/…,
 *      api.whatsapp.com/send?phone=…) — the shop itself says so, and gives the
 *      number;
 *   2. a WhatsApp link on its Google Maps listing;
 *   3. the website mentions WhatsApp next to a number, or at all;
 *   4. the number is a mobile — usually on WhatsApp;
 *   5. a landline — WhatsApp Business runs on landlines too (21 of the 34
 *      verified shops in the England list were landlines), so these are worth
 *      the click but not assumed.
 *
 * Every row gets a wa.me link with the intro message filled in, so checking
 * and messaging is one click: if the number is not on WhatsApp, WhatsApp says
 * so straight away. Nothing is ever sent automatically.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clean, stripHtml } from './util.js';

export const DEFAULT_WHATSAPP_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'whatsapp-message.txt');

/** Mobile ranges per country code (E.164 without "+"). */
const MOBILE = [
    /^447[1-57-9]/,      // UK 07…
    /^491[5-7]/,         // Germany 015/016/017
    /^33[67]/,           // France 06/07
    /^324[5-9]/,         // Belgium 045–049
    /^316/,              // Netherlands 06
    /^352[69]/,          // Luxembourg
    /^417[5-9]/,         // Switzerland
    /^436[5-9]/,         // Austria
    /^9725/,             // Israel 05…
    // The art campaign's world run. Whole numbers (length checked), so a
    // site's number missing its code is read as a mobile only when it is one.
    /^393\d{8,9}$/,      // Italy 3…
    /^34[67]\d{8}$/,     // Spain 6… / 7…
    /^3519[1236]\d{7}$/, // Portugal 91/92/93/96
    /^467[02369]\d{7}$/, // Sweden 070/072/073/076/079
    /^47[49]\d{7}$/,     // Norway 4… / 9…
    /^3538[35-9]\d{7}$/, // Ireland 083, 085–089
    /^3776\d{8}$/,       // Monaco 6…
    /^852[4569]\d{7}$/,  // Hong Kong 4/5/6/9
    /^65[89]\d{7}$/,     // Singapore 8/9
    /^81[789]0\d{8}$/,   // Japan 070/080/090
    /^8210\d{7,8}$/,     // South Korea 010
    /^8869\d{8}$/,       // Taiwan 09
    /^91[6-9]\d{9}$/,    // India 6–9
    /^9715[0-8]\d{7}$/,  // UAE 05x
    /^614\d{8}$/,        // Australia 04
    /^642\d{7,9}$/,      // New Zealand 02x
    /^55\d{2}9\d{8}$/,   // Brazil: a 9 after the area code
    /^549\d{10}$/,       // Argentina: +54 9 before the area code
    /^573\d{9}$/,        // Colombia 3…
    /^27(?:6\d|7[1-9]|8[1-4])\d{7}$/, // South Africa 06x, 071–079, 081–084
];

/**
 * Service numbers no one can message: Israel's 1-700 / 1-800 / 1-599 lines
 * (+972 1…), which forward to a call centre or a switchboard.
 */
const SERVICE = [
    /^9721[5-9]\d{8}$/,
];

export function isServiceNumber(e164) {
    const d = String(e164 || '').replace(/\D/g, '');
    return SERVICE.some(re => re.test(d));
}

export function isMobile(e164) {
    const d = String(e164 || '').replace(/\D/g, '');
    return MOBILE.some(re => re.test(d));
}

/**
 * US and Canadian (+1) mobiles share area codes with landlines, so the number
 * alone says nothing: "mobile number" and "landline" would both be guesses.
 */
export function mobileUnknowable(e164) {
    return /^\+?1\d{10}$/.test(String(e164 || '').replace(/[^\d+]/g, ''));
}

/** "+44 7958 131295", "07958131295", "0044 7958…" → "+447958131295". */
export function normaliseNumber(raw, phoneCode = '49') {
    const s = String(raw || '').trim();
    let d = s.replace(/\D/g, '');
    if (!d) return '';
    if (/^\+/.test(s)) { /* already international */ }
    else if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0')) d = phoneCode + d.slice(1);
    // US: "(718) 555-1234" has no trunk 0; ten digits are a national number.
    else if (phoneCode === '1' && d.length === 10) d = '1' + d;
    if (d.length < 8 || d.length > 15) return '';
    return '+' + d;
}

const LINK_RE = /(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?(?:[^"'\s<>]*?&(?:amp;)?)?phone=|web\.whatsapp\.com\/send\/?\?(?:[^"'\s<>]*?&(?:amp;)?)?phone=|whatsapp:\/\/send\/?\?(?:[^"'\s<>]*?&(?:amp;)?)?phone=)(\+?[\d%\s().-]{7,20})/gi;

/** Countries whose numbers never start with 0 after the country code. */
const NO_ZERO_AFTER_CODE = ['972', '49', '44', '33', '32', '31', '43', '41', '46', '45', '47', '358', '353', '34', '351', '30', '48', '36', '420', '40', '90', '1',
    '81', '82', '886', '852', '65', '91', '971', '61', '64', '27', '52', '54', '55', '57'];

/**
 * Numbers sites write wrongly into WhatsApp links, from the Israel and
 * Germany sushi runs:
 *   - the trunk 0 kept after the code: "+972 058…", "+49 0211…" → drop the 0;
 *   - no country code: "wa.me/527320122" is Israel's 052-732-0122, not
 *     +52 732 0122. Nine digits or fewer are too short for an international
 *     number, so they get the market's code; ten or eleven ("wa.me/15730642210",
 *     a German 01573 mobile, not +1 573) only when that makes one of its mobiles.
 */
export function fixMissingCode(e164, phoneCode) {
    let d = String(e164 || '').replace(/\D/g, '');
    if (!d) return e164;
    // One of the market's own mobiles first: a Colombian "wa.me/3101234567"
    // is +57 310…, not the Netherlands with its trunk 0 kept (+31 0…).
    if (phoneCode && !d.startsWith(phoneCode) && d.length <= 11 && isMobile(phoneCode + d)) return `+${phoneCode}${d}`;
    const code = NO_ZERO_AFTER_CODE.find(c => d.startsWith(c + '0'));
    if (code) return `+${code}${d.slice(code.length + 1)}`;
    if (!phoneCode || d.startsWith(phoneCode) || d.length > 11) return e164;
    if (d.length <= 9 || isMobile(phoneCode + d)) return `+${phoneCode}${d}`;
    return e164;
}

/**
 * WhatsApp evidence in a page.
 * @returns {{ numbers: string[], linked: boolean, mentioned: boolean }}
 */
export function extractWhatsApp(html, phoneCode = '49') {
    const src = String(html || '');
    const numbers = [];
    const add = (raw) => {
        let r = raw;
        try { r = decodeURIComponent(raw); } catch { /* keep as is */ }
        // wa.me numbers are written without a "+" but are always international.
        const n = normaliseNumber(/^\+|^00/.test(r.trim()) ? r
            // "wa.me/0176…" is a local number written into the link: it
            // gets the country code, not "+176…".
            : /^\s*0[1-9]/.test(r) ? r : '+' + r.replace(/^\s*0+/, ''), phoneCode);
        const fixed = n && fixMissingCode(n, phoneCode);
        if (fixed && !numbers.includes(fixed)) numbers.push(fixed);
    };
    let linked = false;
    for (const m of src.matchAll(LINK_RE)) { linked = true; add(m[1]); }
    // Short links and chat widgets without a number in the URL still say "we're on WhatsApp".
    if (/wa\.link\/|chat\.whatsapp\.com\/|class=["'][^"']*whats-?app|whatsapp-(?:button|widget|chat|float)/i.test(src)) linked = true;

    const text = stripHtml(src);
    const mentioned = /whats\s?app/i.test(text);
    // "WhatsApp: +44 7958 131295", "WhatsApp 06 12 34 56 78"
    for (const m of text.matchAll(/whats\s?app[^0-9+]{0,25}(\+?\d[\d\s().\/-]{7,18}\d)/gi)) {
        const n = fixMissingCode(normaliseNumber(m[1], phoneCode), '');
        if (n && !numbers.includes(n)) numbers.push(n);
    }
    return { numbers, linked: linked || numbers.length > 0, mentioned };
}

export const WA = {
    LINK_SITE: 'Yes — WhatsApp link on website',
    LINK_LISTING: 'Yes — WhatsApp link on Google listing',
    MENTIONED: 'Likely — website mentions WhatsApp',
    MOBILE: 'Likely — mobile number',
    LANDLINE: 'Check — landline (WhatsApp Business possible)',
    UNKNOWN: 'Check — US number (mobile or landline unknown)',
    SERVICE: 'No — 1-700 / 1-800 service number',
    NONE: 'No phone',
};

const PRIORITY = {
    [WA.LINK_SITE]: 1, [WA.LINK_LISTING]: 1, [WA.MENTIONED]: 2, [WA.MOBILE]: 2, [WA.LANDLINE]: 3, [WA.UNKNOWN]: 3, [WA.SERVICE]: 4, [WA.NONE]: 4,
};

export function whatsappPriority(status) {
    return PRIORITY[status] || 4;
}

/**
 * Decide a lead's WhatsApp status from the evidence stored on it:
 *   whatsapp_site_numbers  "; "-joined numbers linked/named on its website
 *   whatsapp_site_linked   a WhatsApp link or widget on its website
 *   whatsapp_mentioned     its website says "WhatsApp"
 *   whatsapp_listing       WhatsApp link(s) on its Maps listing
 *   whatsapp_verified      set by hand ("yes"/"no") — always wins
 */
export function classifyWhatsApp(lead) {
    const phone = clean(lead.phone);
    const siteNumbers = String(lead.whatsapp_site_numbers || '').split(/;\s*/).filter(Boolean);
    const listing = String(lead.whatsapp_listing || '').split(/;\s*/).filter(Boolean);
    const manual = clean(lead.whatsapp_verified).toLowerCase();

    if (/^(yes|y|ja|oui|true|1|whatsapp)/.test(manual)) {
        return { status: 'Yes — verified by hand', number: siteNumbers[0] || listing[0] || phone, priority: 1 };
    }
    if (/^(no|n|nein|non|false|0)/.test(manual)) {
        return { status: 'No — verified by hand', number: '', priority: 4 };
    }
    if (siteNumbers.length || lead.whatsapp_site_linked) {
        // Prefer the linked number that is the listing's own phone.
        const number = siteNumbers.find(n => n === phone) || siteNumbers[0] || (isServiceNumber(phone) ? '' : phone);
        if (number) return { status: WA.LINK_SITE, number, priority: 1 };
    }
    if (listing.length) return { status: WA.LINK_LISTING, number: listing[0], priority: 1 };
    if (!phone) return { status: WA.NONE, number: '', priority: 4 };
    if (isServiceNumber(phone)) return { status: WA.SERVICE, number: '', priority: 4 };
    if (lead.whatsapp_mentioned) return { status: WA.MENTIONED, number: phone, priority: 2 };
    if (mobileUnknowable(phone)) return { status: WA.UNKNOWN, number: phone, priority: 3 };
    if (isMobile(phone)) return { status: WA.MOBILE, number: phone, priority: 2 };
    return { status: WA.LANDLINE, number: phone, priority: 3 };
}

export function loadWhatsAppTemplate(file = DEFAULT_WHATSAPP_TEMPLATE) {
    try { return fs.readFileSync(path.resolve(file), 'utf8').replace(/\r\n/g, '\n').trim(); } catch { return ''; }
}

/** https://wa.me/<digits>?text=<message> — opens the chat with the intro typed in, not sent. */
export function whatsappLink(number, message = '') {
    const d = String(number || '').replace(/\D/g, '');
    if (!d) return '';
    return `https://wa.me/${d}` + (message ? `?text=${encodeURIComponent(message)}` : '');
}
