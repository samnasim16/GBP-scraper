/**
 * Small, dependency-free helpers shared across the scraper.
 * Everything here is a pure function so it can be unit-tested without a browser.
 */

export const sleep = (ms) => new Promise(r => setTimeout(r, ms + Math.random() * Math.min(800, Math.max(0, ms))));

/** Collapse whitespace and trim. Safe on null/undefined. */
export function clean(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Words that carry no identity — dropped before comparing business names. */
const NAME_STOPWORDS = new Set([
    'llc', 'l.l.c', 'inc', 'incorporated', 'co', 'company', 'corp', 'corporation',
    'ltd', 'llp', 'pllc', 'pc', 'the', 'and', 'of', 'a', 'an',
    'services', 'service', 'svc', 'svcs', 'solutions', 'group', 'enterprises',
    'professional', 'professionals', 'quality', 'best', 'affordable',
]);

/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalizeName(s) {
    return String(s ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/['’`]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Identity-bearing tokens of a business name (stopwords + 1-char noise removed). */
export function nameTokens(s) {
    return normalizeName(s)
        .split(' ')
        .filter(t => t.length > 1 && !NAME_STOPWORDS.has(t));
}

/**
 * Fraction of the business's identity tokens present in `text`, 0..1.
 * Directional on purpose: we ask "does this page mention the business",
 * not "are these two strings similar", so a long page is not penalised.
 */
export function tokenCoverage(businessName, text) {
    const tokens = nameTokens(businessName);
    if (tokens.length === 0) return 0;
    const hay = ' ' + normalizeName(text) + ' ';
    let hits = 0;
    for (const t of tokens) if (hay.includes(' ' + t) || hay.includes(t)) hits++;
    return hits / tokens.length;
}

export function digitsOnly(s) {
    return String(s ?? '').replace(/\D/g, '');
}

/** US phone → +1XXXXXXXXXX, or null when it isn't a plausible US number. */
export function normalizePhone(raw) {
    const d = digitsOnly(raw);
    if (d.length === 10) return `+1${d}`;
    if (d.length === 11 && d[0] === '1') return `+${d}`;
    return null;
}

/** Every way a US number tends to be written, for text matching. */
export function phoneVariants(e164) {
    const d = digitsOnly(e164);
    if (d.length !== 11 || d[0] !== '1') return d ? [d] : [];
    const a = d.slice(1, 4), b = d.slice(4, 7), c = d.slice(7);
    return [
        `${a}${b}${c}`,
        `(${a}) ${b}-${c}`, `(${a})${b}-${c}`,
        `${a}-${b}-${c}`, `${a}.${b}.${c}`, `${a} ${b} ${c}`,
        `+1${a}${b}${c}`, `1${a}${b}${c}`,
    ];
}

/** True when any common rendering of the phone number appears in the text. */
export function textHasPhone(text, e164) {
    if (!text || !e164) return false;
    const compact = digitsOnly(text);
    const bare = digitsOnly(e164).replace(/^1/, '');
    if (bare.length === 10 && compact.includes(bare)) return true;
    const lower = String(text).toLowerCase();
    return phoneVariants(e164).some(v => lower.includes(v.toLowerCase()));
}

const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    '#39': "'", '#039': "'", '#x27': "'", '#x2F': '/', '#47': '/', '#x3D': '=',
};

/** Decode the handful of HTML entities that actually show up in search results. */
export function decodeEntities(s) {
    return String(s ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
        if (Object.prototype.hasOwnProperty.call(ENTITIES, code)) return ENTITIES[code];
        if (/^#x/i.test(code)) {
            const n = parseInt(code.slice(2), 16);
            return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        if (/^#/.test(code)) {
            const n = parseInt(code.slice(1), 10);
            return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        return m;
    });
}

/** Crude but robust tag stripper — we only need readable text, not structure. */
export function stripHtml(html) {
    return clean(decodeEntities(
        String(html ?? '')
            .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
            // Context is sliced out of a page by offset, so a slice can begin or
            // end inside a tag. Those half-tags survive the tag regex below and
            // end up as raw markup in the output — an actual `<svg fill="none"`
            // once reached the Description column.
            .replace(/^[^<>]*>/, ' ')
            .replace(/<[^>]*$/, ' ')
            .replace(/<[^>]+>/g, ' ')
    ));
}

/** Truncate on a word boundary, appending an ellipsis when cut. */
export function truncate(s, max) {
    const str = clean(s);
    if (str.length <= max) return str;
    const cut = str.slice(0, max);
    const sp = cut.lastIndexOf(' ');
    return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '…';
}

/** Title Case, leaving existing ALLCAPS acronyms of 2-3 chars alone. */
export function titleCase(s) {
    return clean(s).replace(/\S+/g, w =>
        (/^[A-Z0-9]{2,3}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    );
}
