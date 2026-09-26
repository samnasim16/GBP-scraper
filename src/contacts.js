/**
 * Contact enrichment: from a shop's website, find an email address and the
 * name of the person to write to.
 *
 * Germany makes this unusually reliable. Every commercial website must carry
 * an **Impressum** (§ 5 DDG, formerly TMG) naming the owner or managing
 * director and giving an email address. So for each lead with a website we
 * read the homepage, follow its Impressum / Kontakt / About links (or guess
 * the usual paths when none is linked), and pull:
 *
 *   - every email on those pages, de-obfuscated and ranked
 *   - the Inhaber / Geschäftsführer / "Vertreten durch" name
 *   - the visible text, which feeds the Judaica relevance score
 *   - Facebook / Instagram links, as a second channel
 *
 * The pure functions are exported for tests; `ContactEnricher` is the pool.
 */

import { clean, stripHtml, decodeEntities, nameTokens } from './util.js';

// ─── Email extraction ─────────────────────────────────────────────────────

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)*\.[A-Z]{2,24}/gi;

/** Things that match the email pattern but are not anyone's inbox. */
const JUNK_EMAIL = [
    /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|woff2?|ttf)$/i,
    /@(example|domain|email|beispiel|test|yourdomain|ihredomain|mustermann|sentry|sentry-next|wixpress|sentry\.wixpress)\./i,
    /@(\d+x|2x|3x)\./i,
    /^(name|vorname\.nachname|ihre?\.?email|your\.?email|email|user|username|max\.mustermann)@/i,
    /@.*\.(local|invalid|lan)$/i,
    /(sentry|wixpress|cloudflare|googleapis|schema\.org|w3\.org)/i,
];

/** Cloudflare's "email protection" hides addresses as a hex XOR string. */
export function decodeCfEmail(hex) {
    try {
        const key = parseInt(hex.slice(0, 2), 16);
        let out = '';
        for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
        return out;
    } catch {
        return '';
    }
}

/**
 * Undo the usual human obfuscations: "info [at] shop [dot] de",
 * "info(at)shop.de", "info (ät) shop . de", "info{at}shop.de".
 */
export function deobfuscate(text) {
    return String(text || '')
        .replace(/\s*[[({<]\s*(?:at|ät|@)\s*[\])}>]\s*/gi, '@')
        .replace(/\s*[[({<]\s*(?:dot|punkt|\.)\s*[\])}>]\s*/gi, '.')
        .replace(/([A-Z0-9._%+-]+)\s+(?:at|ät)\s+([A-Z0-9-]+)\s+(?:dot|punkt)\s+([A-Z]{2,24})\b/gi, '$1@$2.$3');
}

/** All plausible email addresses in a page, lower-cased, in page order. */
export function extractEmails(html) {
    const found = [];
    const add = (e) => {
        const v = clean(decodeURIComponentSafe(e)).toLowerCase().replace(/^mailto:/, '').replace(/[.,;:]+$/, '');
        if (!v || !v.includes('@') || v.length > 80) return;
        if (JUNK_EMAIL.some(re => re.test(v))) return;
        if (!found.includes(v)) found.push(v);
    };

    const src = String(html || '');
    for (const m of src.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) add(m[1]);
    for (const m of src.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']/gi)) add(decodeCfEmail(m[1]));
    for (const m of src.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) add(decodeCfEmail(m[1]));

    const text = deobfuscate(decodeEntities(stripHtml(src)));
    for (const m of text.matchAll(EMAIL_RE)) add(m[0]);
    // Also scan raw markup: some sites keep the address only in a JSON-LD
    // block or a data attribute that stripHtml throws away.
    for (const m of decodeEntities(src).matchAll(EMAIL_RE)) add(m[0]);
    return found;
}

function decodeURIComponentSafe(s) {
    try { return decodeURIComponent(s); } catch { return s; }
}

/** example.co.uk → example.co.uk; shop.example.de → example.de */
export function registrableDomain(host) {
    const parts = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    const twoLevel = /^(co|com|org|net|gov|ac)$/.test(parts[parts.length - 2]);
    return parts.slice(twoLevel ? -3 : -2).join('.');
}

const GOOD_PREFIX = /^(info|kontakt|contact|shop|office|mail|hello|hallo|service|bestellung|order|verkauf|sales|laden|store|post|team)@/;
const BAD_PREFIX = /^(no-?reply|donotreply|datenschutz|privacy|dsgvo|abuse|postmaster|hostmaster|webmaster|bewerbung|jobs|karriere|presse|press|newsletter|rechnung|invoice|buchhaltung)@/;
/** "Made by pixelagentur.de" — the site's builder, not the shop. */
const AGENCY_DOMAIN = /(agentur|agency|webdesign|design|werbung|media|medien|digital|marketing|hosting|studio|webservice|internet|-it\.|software|wix|jimdo|shopify|strato|ionos)/;
const FREEMAIL = /@(gmail|googlemail|gmx|web|t-online|yahoo|hotmail|outlook|icloud|aol|freenet|posteo|mail|arcor|live|me)\./;

/**
 * Rank addresses and return the best one first.
 * An address on the shop's own domain beats a freemail one, which beats the
 * web agency's address in the footer ("made by agentur@…").
 */
export function rankEmails(emails, websiteUrl = '', businessName = '') {
    let siteDomain = '';
    try { siteDomain = registrableDomain(new URL(websiteUrl).hostname); } catch { /* no website */ }
    if (/^[\d.]+$|^localhost$/.test(siteDomain)) siteDomain = '';
    const nameWords = nameTokens(businessName).filter(t => t.length >= 4);

    const score = (e) => {
        const domain = registrableDomain(e.split('@')[1] || '');
        const squashed = domain.replace(/[^a-z0-9]/g, '');
        let s = 0;
        if (siteDomain && domain === siteDomain) s += 40;
        else if (FREEMAIL.test(e)) s += 15;
        else if (siteDomain) s -= 5;   // someone else's domain: usually the web agency
        if (domain !== siteDomain && AGENCY_DOMAIN.test(domain)) s -= 25;
        // A domain that spells the business name is the business's own.
        if (!FREEMAIL.test(e) && nameWords.some(w => squashed.includes(w))) s += 20;
        if (GOOD_PREFIX.test(e)) s += 10;
        if (BAD_PREFIX.test(e)) s -= 30;
        return s;
    };
    return [...emails]
        .map((e, i) => ({ e, s: score(e), i }))
        .sort((a, b) => (b.s - a.s) || (a.i - b.i))
        .map(x => x.e);
}

// ─── Contact person ───────────────────────────────────────────────────────

const NAME_WORD = "[A-ZÄÖÜ][a-zäöüßéèáàíóúñç'’\\-]+";
const PARTICLE = '(?:von|van|der|den|de|zu|del|da|di|ben|bat|el|al)';
const NAME = `(?:(?:Frau|Herr|Fr\\.|Hr\\.|Mrs?\\.?|Ms\\.?)\\s+)?(?:(?:Dr|Prof|Dipl\\.-\\w+)\\.?\\s+)*${NAME_WORD}(?:\\s+(?:${PARTICLE}\\s+)?${NAME_WORD}){1,3}`;

/** Labels, in order of how directly they name the person to address. */
const ROLE_LABELS = [
    'Inhaberin', 'Inhaber', 'Inh\\.', 'Geschäftsführerin', 'Geschäftsführer', 'Geschäftsführung',
    'Vertreten durch(?: die| den)?(?: Geschäftsführer(?:in)?| Inhaber(?:in)?)?',
    'Vertretungsberechtigte[rn]? (?:Geschäftsführer(?:in)?|Gesellschafter(?:in)?|Person)',
    'Owner', 'Proprietor', 'Managing Director', 'CEO', 'Represented by',
    'Verantwortlich(?: für den Inhalt)?(?: nach| gemäß| gem\\.| i\\.S\\.d\\.)?(?: §+ ?\\d+[^:]{0,30})?',
    'V\\.i\\.S\\.d\\.P\\.', 'Ansprechpartner(?:in)?', 'Kontaktperson',
];

/** Words that look like names but are really the next label or a company. */
const NOT_A_NAME = /\b(GmbH|UG|AG|KG|OHG|GbR|e\.K|e\.V|Straße|Strasse|Str\.|Platz|Weg|Allee|Telefon|Tel|Fax|E-Mail|Email|Mail|Registergericht|Amtsgericht|Handelsregister|Umsatzsteuer|USt|Steuernummer|Kontakt|Anschrift|Adresse|Impressum|Deutschland|Germany|Berlin|München|Hamburg|Köln|Frankfurt|Shop|Laden|Galerie|Verlag|Buchhandlung|Judaica|Museum|Gemeinde|Stiftung|Haftung|Inhalt|Inhalte|Angaben|Gemäß|Verantwortlich)\b/i;

/** "Fasanenstraße" is a compound, so \\bStraße misses it. */
const STREET_WORD = /(straße|strasse|str\.|platz|allee|gasse|weg)[,.]?$/i;

/** The GmbH or the person? "Geschäftsführer: Max Muster, Anna Beispiel" → first person. */
export function extractContactName(text) {
    const t = clean(String(text || '').replace(/ /g, ' '));
    for (const label of ROLE_LABELS) {
        const re = new RegExp(`(?:^|[\\s.;,|])${label}\\s*(?:\\(in\\))?\\s*[:\\-–]?\\s*(${NAME})`, 'u');
        const m = t.match(re);
        if (!m) continue;
        const name = tidyName(m[1]);
        if (name) return name;
    }
    return '';
}

function tidyName(raw) {
    let n = clean(raw);
    // Stop at the first word that is clearly the next field.
    const words = n.split(' ');
    const kept = [];
    for (const w of words) {
        if (NOT_A_NAME.test(w) || STREET_WORD.test(w) || /\d/.test(w)) break;
        kept.push(w);
    }
    n = kept.join(' ');
    const core = n.replace(/^(Frau|Herr|Fr\.|Hr\.|Mrs?\.?|Ms\.?)\s+/i, '').replace(/^((Dr|Prof)\.?\s+)+/i, '');
    if (core.split(' ').filter(Boolean).length < 2) return '';
    return n;
}

/**
 * The greeting line for the email. We only use a gendered form when the site
 * itself told us (Frau/Herr, Inhaberin/Inhaber); otherwise the full name,
 * which is correct in either case.
 *   "Frau Dr. Anna Weiss" → "Dear Ms. Weiss"
 *   "Max Muster"          → "Dear Max Muster"
 *   ""                    → "Dear Judaica Haus Berlin team"
 */
export function greetingFor({ contact_name: name = '', contact_role: role = '', business_name: biz = '' } = {}) {
    const n = clean(name);
    if (!n) return clean(biz) ? `Dear ${clean(biz)} Team` : 'Dear Sir or Madam';
    const female = /^(Frau|Fr\.|Mrs?\.?|Ms\.?)\s/i.test(n) || /(Inhaberin|Geschäftsführerin)/.test(role);
    const male = /^(Herr|Hr\.|Mr\.?)\s/i.test(n) || (/^(Inhaber|Geschäftsführer)$/.test(role));
    const bare = n.replace(/^(Frau|Herr|Fr\.|Hr\.|Mrs?\.?|Ms\.?)\s+/i, '');
    const title = (bare.match(/^((?:Dr|Prof)\.?\s+)+/i) || [''])[0];
    const parts = bare.replace(/^((?:Dr|Prof)\.?\s+)+/i, '').split(' ');
    // Keep particles with the surname: "von Weizsäcker".
    let i = parts.length - 1;
    while (i > 0 && new RegExp(`^${PARTICLE}$`, 'i').test(parts[i - 1])) i--;
    const surname = parts.slice(i).join(' ');
    if (female) return `Dear Ms. ${title}${surname}`.replace(/\s+/g, ' ');
    if (male) return `Dear Mr. ${title}${surname}`.replace(/\s+/g, ' ');
    return `Dear ${bare}`;
}

/** Which role label the name was found under — used to infer the salutation. */
export function extractContactRole(text) {
    const m = clean(text).match(/\b(Inhaberin|Inhaber|Geschäftsführerin|Geschäftsführer|Owner|Managing Director)\b/);
    return m ? m[1] : '';
}

// ─── Link discovery ───────────────────────────────────────────────────────

const CONTACT_LINK = /(impressum|imprint|legal[-_ ]?notice|kontakt|contact|about|ueber[-_]?uns|über[-_]?uns|uber[-_]?uns|wir|team|anbieterkennzeichnung)/i;

/** Same-site links to the Impressum, Kontakt and About pages, best first. */
export function findContactLinks(html, baseUrl, { max = 4 } = {}) {
    let base;
    try { base = new URL(baseUrl); } catch { return []; }
    const siteDomain = registrableDomain(base.hostname);
    const scored = new Map();
    for (const m of String(html || '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const href = decodeEntities(m[1]).trim();
        const label = stripHtml(m[2]);
        if (/^(mailto|tel|javascript):/i.test(href)) continue;
        if (!CONTACT_LINK.test(href) && !CONTACT_LINK.test(label)) continue;
        let url;
        try { url = new URL(href, base); } catch { continue; }
        if (!/^https?:$/.test(url.protocol)) continue;
        if (registrableDomain(url.hostname) !== siteDomain) continue;
        if (/\.(pdf|jpe?g|png|zip)$/i.test(url.pathname)) continue;
        url.hash = '';
        const key = url.toString();
        const hay = href + ' ' + label;
        const s = /impressum|imprint|legal/i.test(hay) ? 3 : /kontakt|contact/i.test(hay) ? 2 : 1;
        scored.set(key, Math.max(scored.get(key) || 0, s));
    }
    return [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([u]) => u);
}

/** Where German sites keep the Impressum when the homepage doesn't link it. */
export function guessContactUrls(baseUrl) {
    try {
        const o = new URL(baseUrl).origin;
        return [`${o}/impressum`, `${o}/kontakt`, `${o}/impressum/`, `${o}/pages/impressum`, `${o}/imprint`];
    } catch {
        return [];
    }
}

/** Facebook / Instagram profile links on the site — a second way in. */
export function findSocialLinks(html) {
    const out = { facebook: '', instagram: '' };
    for (const m of String(html || '').matchAll(/https?:\/\/(?:www\.|de-de\.|m\.)?(facebook|instagram)\.com\/[A-Za-z0-9_.\-/?=]+/gi)) {
        const url = m[0].replace(/[?#].*$/, '').replace(/\/+$/, '');
        const platform = m[1].toLowerCase();
        if (/\/(sharer|share|dialog|plugins|tr|p|reel|explore|hashtag|events|groups)(\/|$)/i.test(url)) continue;
        if (!out[platform]) out[platform] = url;
    }
    return out;
}

// ─── The worker pool ──────────────────────────────────────────────────────

export const DEFAULT_CONTACTS = {
    enabled: true,
    concurrency: 3,
    maxPagesPerSite: 4,
    delayMs: 600,
    guessImpressum: true,
};

/**
 * Fetch each lead's site and fill email / contact / relevance fields in place.
 * `http` is a client from `createHttpClient`; `onDone(lead)` runs after each.
 */
export class ContactEnricher {
    constructor({ http, config = {}, log = console.log, onDone = () => {} } = {}) {
        this.opts = { ...DEFAULT_CONTACTS, ...config };
        this.enabled = this.opts.enabled !== false;
        this.http = http;
        this.log = log;
        this.onDone = onDone;
        this.queue = [];
        this.active = 0;
        this.idle = [];
        this.stats = { sites: 0, pages: 0, withEmail: 0, withName: 0, failed: 0 };
    }

    enqueue(lead) {
        if (!this.enabled) return Promise.resolve(lead);
        return new Promise((resolve) => {
            this.queue.push({ lead, resolve });
            this._pump();
        });
    }

    _pump() {
        while (this.active < this.opts.concurrency && this.queue.length) {
            const { lead, resolve } = this.queue.shift();
            this.active++;
            this.enrich(lead)
                .catch((e) => { this.stats.failed++; this.log(`    ⚠️  Contact lookup failed for ${lead.business_name}: ${e.message}`); })
                .finally(() => {
                    this.active--;
                    try { this.onDone(lead); } catch { /* caller's problem */ }
                    resolve(lead);
                    if (this.active === 0 && this.queue.length === 0) this.idle.splice(0).forEach(r => r());
                    this._pump();
                });
        }
    }

    drain() {
        if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
        return new Promise(r => this.idle.push(r));
    }

    async _get(url) {
        const res = await this.http.fetchText(url, { headers: { 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' } });
        if (this.opts.delayMs) await new Promise(r => setTimeout(r, this.opts.delayMs));
        if (!res.ok || !res.body) return null;
        this.stats.pages++;
        return res.body;
    }

    /** Returns { emails, contactName, contactRole, siteText, social } and applies them to `lead`. */
    async enrich(lead) {
        const site = clean(lead.website);
        const result = { emails: [], contactName: '', contactRole: '', siteText: '', social: {} };
        if (lead.email) result.emails.push(lead.email);

        if (site && /^https?:\/\//i.test(site) && !/(facebook|instagram)\.com/i.test(site)) {
            this.stats.sites++;
            const home = await this._get(site);
            const pages = [];
            if (home) {
                pages.push(home);
                this._absorb(home, result);
                const links = findContactLinks(home, site, { max: this.opts.maxPagesPerSite });
                const hasImpressum = links.some(u => /impressum|imprint|legal/i.test(u));
                const guesses = (this.opts.guessImpressum && !hasImpressum) ? guessContactUrls(site).slice(0, 2) : [];
                for (const url of [...links, ...guesses].slice(0, this.opts.maxPagesPerSite)) {
                    const body = await this._get(url);
                    if (!body) continue;
                    pages.push(body);
                    this._absorb(body, result);
                    // Stop early once we have both an address and a person.
                    if (result.emails.length && result.contactName) break;
                }
            }
            result.siteText = pages.map(p => stripHtml(p)).join(' ').slice(0, 200000);
            for (const p of pages) {
                const s = findSocialLinks(p);
                result.social.facebook = result.social.facebook || s.facebook;
                result.social.instagram = result.social.instagram || s.instagram;
            }
        } else if (/(facebook|instagram)\.com/i.test(site)) {
            // The "website" is a social page: keep it as the social channel.
            result.social[/instagram/i.test(site) ? 'instagram' : 'facebook'] = site;
        }

        applyContacts(lead, result);
        if (lead.email) this.stats.withEmail++;
        if (lead.contact_name) this.stats.withName++;
        return result;
    }

    _absorb(html, result) {
        for (const e of extractEmails(html)) if (!result.emails.includes(e)) result.emails.push(e);
        if (!result.contactName) {
            const text = stripHtml(html);
            result.contactName = extractContactName(text);
            if (result.contactName) result.contactRole = extractContactRole(text);
        }
    }
}

/** Write an enrichment result onto the lead row. */
export function applyContacts(lead, result) {
    const ranked = rankEmails(result.emails, lead.website, lead.business_name);
    lead.email = ranked[0] || lead.email || '';
    lead.other_emails = ranked.slice(1, 4).join('; ');
    if (result.contactName) {
        lead.contact_name = result.contactName;
        lead.contact_role = result.contactRole || '';
    }
    lead.facebook_url = lead.facebook_url || result.social.facebook || '';
    lead.instagram_url = lead.instagram_url || result.social.instagram || '';
    lead._siteText = result.siteText || '';
    return lead;
}
