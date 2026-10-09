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
];

export function isMobile(e164) {
    const d = String(e164 || '').replace(/\D/g, '');
    return MOBILE.some(re => re.test(d));
}

/** "+44 7958 131295", "07958131295", "0044 7958…" → "+447958131295". */
export function normaliseNumber(raw, phoneCode = '49') {
    const s = String(raw || '').trim();
    let d = s.replace(/\D/g, '');
    if (!d) return '';
    if (/^\+/.test(s)) { /* already international */ }
    else if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0')) d = phoneCode + d.slice(1);
    if (d.length < 8 || d.length > 15) return '';
    return '+' + d;
}

const LINK_RE = /(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?(?:[^"'\s<>]*?&(?:amp;)?)?phone=|web\.whatsapp\.com\/send\/?\?(?:[^"'\s<>]*?&(?:amp;)?)?phone=|whatsapp:\/\/send\/?\?(?:[^"'\s<>]*?&(?:amp;)?)?phone=)(\+?[\d%\s().-]{7,20})/gi;

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
        const n = normaliseNumber(/^\+|^00/.test(r.trim()) ? r : '+' + r.replace(/^\s*0+/, ''), phoneCode);
        if (n && !numbers.includes(n)) numbers.push(n);
    };
    let linked = false;
    for (const m of src.matchAll(LINK_RE)) { linked = true; add(m[1]); }
    // Short links and chat widgets without a number in the URL still say "we're on WhatsApp".
    if (/wa\.link\/|chat\.whatsapp\.com\/|class=["'][^"']*whats-?app|whatsapp-(?:button|widget|chat|float)/i.test(src)) linked = true;

    const text = stripHtml(src);
    const mentioned = /whats\s?app/i.test(text);
    // "WhatsApp: +44 7958 131295", "WhatsApp 06 12 34 56 78"
    for (const m of text.matchAll(/whats\s?app[^0-9+]{0,25}(\+?\d[\d\s().\/-]{7,18}\d)/gi)) {
        const n = normaliseNumber(m[1], phoneCode);
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
    NONE: 'No phone',
};

const PRIORITY = {
    [WA.LINK_SITE]: 1, [WA.LINK_LISTING]: 1, [WA.MENTIONED]: 2, [WA.MOBILE]: 2, [WA.LANDLINE]: 3, [WA.NONE]: 4,
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
        const number = siteNumbers.find(n => n === phone) || siteNumbers[0] || phone;
        if (number) return { status: WA.LINK_SITE, number, priority: 1 };
    }
    if (listing.length) return { status: WA.LINK_LISTING, number: listing[0], priority: 1 };
    if (!phone) return { status: WA.NONE, number: '', priority: 4 };
    if (lead.whatsapp_mentioned) return { status: WA.MENTIONED, number: phone, priority: 2 };
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
