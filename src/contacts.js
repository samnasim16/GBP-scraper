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
import { extractWhatsApp } from './whatsapp.js';

// ─── Email extraction ─────────────────────────────────────────────────────

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)*\.[A-Z]{2,24}/gi;

/** Things that match the email pattern but are not anyone's inbox. */
const JUNK_EMAIL = [
    /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|woff2?|ttf)$/i,
    /@(example|domain|email|beispiel|test|yourdomain|ihredomain|mustermann|sentry|sentry-next|wixpress|sentry\.wixpress)\./i,
    /@(\d+x|2x|3x)\./i,
    /^(name|vorname\.nachname|ihre?\.?email|your\.?email|email|user|username|max\.mustermann)@/i,
    // Placeholder addresses left in contact forms and templates. France had
    // example@mail.com, prenom.nom@domaine.com and jean.dupont@gmail.com
    // (the French "John Smith").
    /^(example|exemple|sample|prenom\.?nom|pr[ée]nom|nom|votre[.-]?(e-?mail|adresse|mail|nom)|jean\.?dupont|john\.?doe|jane\.?doe|john\.?smith|max\.?muster|test|demo)@/i,
    /@(domaine|exemple|example|monsite|votresite|votredomaine|tonsite|yoursite|yourdomain)\.[a-z]+$/i,
    /@.*\.(local|invalid|lan)$/i,
    /(sentry|wixpress|cloudflare|googleapis|schema\.org|w3\.org)/i,
    // Demo content of website themes, left on live shops: Torah Treasures'
    // site carried contact@, career@ and customercare@martfury.com, the
    // placeholder inboxes of the "Martfury" WooCommerce theme.
    /@(martfury|nest|pressmart|envato|themeforest|templatemonster|flatsome|woodmart|porto|electro|shopkeeper|basel|ecomus|kalles|minimog|elessi|yourstore|yourshop|yoursite|yourcompany|mysite|mystore|company|website|store|shop|demo)\.(com|net|org|io)$/i,
    /@(demo|themes?|template)[.-]/i,
    // The shop software's own addresses, left in page source by the
    // platform: Emet (Paris) came back as license@prestashop.com.
    /@(prestashop|woocommerce|woothemes|shopify|wordpress|wix|jimdo|squarespace|magento|opencart|shopware|oxid|ionos|strato|ovh|o2switch|hostinger|gandi|elementor|wpengine|automattic|alloj|202-ecommerce|presta-module|prestaplugins|webkul|knowband|boostmyshop)\.(com|net|org|io|fr|de|eu)$/i,
    // A font licence in the stylesheet (New City Kosher Deli came back as
    // info@indiantypefoundry.com) and app vendors' support inboxes.
    /@[a-z0-9-]*(fonts?|typefoundry|latinotype|typetype|typotheque|jovanny)\.[a-z.]+$/i,
    // Masked or placeholder addresses: "in**@****me.com", "you@isp.com".
    /\*/,
    /^(you|your\.?name|name|user|username)@|@(isp|my-?domain|domain|email)\.(com|net)$/i,
    /@(indiantypefoundry|fontawesome|typekit|myfonts|monotype|fontshop|linotype|fontfabric|fontsquirrel|typotheque|gist-apps|shopifyapps|klaviyo|mailchimp|hubspot|zendesk|tawk|tidio|judge|yotpo|okendo)\.(com|net|org|io|me)$/i,
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
        let v = clean(decodeURIComponentSafe(e)).toLowerCase().replace(/^mailto:/, '').replace(/[.,;:]+$/, '');
        // "mailto:718-852-1111/segulahjudaica@gmail.com": keep the address.
        if (/[\s/\\|]/.test(v)) {
            const only = v.match(new RegExp(EMAIL_RE.source, 'i'));
            if (!only) return;
            v = only[0];
        }
        // "Tel. 030 25993 300info@jmberlin.de": the phone's last digits run
        // straight into the address once markup is stripped.
        const glued = v.match(/^\d+([a-z][^@]*@.*)$/);
        if (glued && GOOD_PREFIX.test(glued[1])) v = glued[1];
        v = repairTld(v);
        if (!v || !v.includes('@') || v.length > 80) return;
        if (JUNK_EMAIL.some(re => re.test(v))) return;
        if (PLATFORM_DOMAIN.test(v.split('@')[1] || '')) return;
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
    // Escapes inside scripts ("\\ninfo@…") are unescaped first, or the "n"
    // becomes part of the address.
    const raw = decodeEntities(src)
        .replace(/\\u00([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\[nrt]/g, ' ');
    for (const m of raw.matchAll(EMAIL_RE)) add(m[0]);
    return dropGlued(found);
}

/** Top-level domains an address can plausibly end in. Any 2-letter code is a country. */
const COMMON_TLD = /^(com|net|org|info|biz|shop|store|online|art|email|berlin|hamburg|koeln|cologne|bayern|nrw|ruhr|saarland|jetzt|gmbh|team|design|gallery|eu|app|io|co|me)$/;

/**
 * "info@israelladen.deein", "buchladen@neuer-weg.comtel": the next word ran
 * into the domain once markup was stripped. Trim back to the real TLD, or
 * drop the address when no real TLD is left.
 */
export function repairTld(email) {
    const at = email.lastIndexOf('@');
    if (at < 0) return email;
    const domain = email.slice(at + 1);
    const dot = domain.lastIndexOf('.');
    if (dot < 0) return '';
    const tld = domain.slice(dot + 1);
    if (tld.length === 2 || COMMON_TLD.test(tld)) return email;
    for (const t of ['de', 'com', 'net', 'org', 'info', 'eu', 'at', 'ch', 'shop', 'art']) {
        if (tld.startsWith(t)) return email.slice(0, at + 1) + domain.slice(0, dot + 1) + t;
    }
    return '';
}

/**
 * "ninfo@kosherstar.de" next to "info@kosherstar.de": the longer one is the
 * shorter with a stray character glued on. Keep the clean one.
 */
function dropGlued(emails) {
    return emails.filter(x => !emails.some(y => y !== x && y.length < x.length
        && x.endsWith(y) && x.length - y.length <= 3));
}

function decodeURIComponentSafe(s) {
    try { return decodeURIComponent(s); } catch { return s; }
}

/** example.co.uk → example.co.uk; shop.example.de → example.de */
export function registrableDomain(host) {
    const parts = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    const twoLevel = /^(co|com|org|net|gov|ac|ltd|plc|me|sch|nhs|muni|k12|idf)$/.test(parts[parts.length - 2]);
    return parts.slice(twoLevel ? -3 : -2).join('.');
}

/**
 * Marketplaces and platforms. A shop whose "website" is its page on one of
 * these has no Impressum of its own — crawling it yields the platform's
 * legal inbox (behoerdenanfragen@kleinanzeigen.de), never the shop's.
 */
export const PLATFORM_DOMAIN = /(^|\.)(kleinanzeigen|ebay|ebay-kleinanzeigen|etsy|amazon|abebooks|booklooker|zvab|dawanda|facebook|instagram|linktr|linkedin|youtube|tiktok|twitter|google|business\.site|wixsite|jimdosite|yelp|tripadvisor|gelbeseiten|dasoertliche|11880|meinestadt|golocal|cylex|kennstdueinen|livre-rare-book|leboncoin|pagesjaunes|2ememain|2dehands|marktplaats|goudengids|pagesdor|infobel|mappy)\.[a-z.]+$/;

const GOOD_PREFIX = /^(info|kontakt|contact|shop|office|mail|hello|hallo|service|bestellung|order|orders|verkauf|sales|laden|store|post|team|enquiries|enquiry|admin|bonjour|commande|commandes|vente|ventes|boutique|magasin|librairie|accueil|winkel|bestelling|bestellingen)@/;
const BAD_PREFIX = /^(no-?reply|donotreply|datenschutz|privacy|dsgvo|abuse|postmaster|hostmaster|webmaster|bewerbung|jobs|karriere|presse|press|newsletter|rechnung|invoice|buchhaltung|rgpd|dpo|recrutement|emploi|facturation|comptabilite|factuur|boekhouding|vacatures)@/;
/** "Made by pixelagentur.de" — the site's builder, not the shop. */
const AGENCY_DOMAIN = /(agentur|agency|webdesign|design|werbung|media|medien|digital|marketing|hosting|studio|webservice|internet|-it\.|software|wix|jimdo|shopify|strato|ionos)/;
const FREEMAIL = /@(gmail|googlemail|gmx|web|t-online|yahoo|hotmail|outlook|icloud|aol|freenet|posteo|mail|arcor|live|me|btinternet|btopenworld|sky|virginmedia|talktalk|blueyonder|ntlworld|tiscali|orange|wanadoo|free|sfr|laposte|neuf|club-internet|skynet|telenet|proximus|scarlet|voo|optonline|optimum|verizon|comcast|att|sbcglobal|bellsouth|earthlink|msn|ymail|rocketmail|aim|juno|netzero|cox|charter|spectrum|frontier|protonmail|[a-z]+\.rr|walla|netvision|bezeqint|zahav|smile|012|013|013net|actcom|barak|inter)\./;

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
    // A deep page on someone else's domain ("chabad-duesseldorf.de/…/aid/3860766"
    // for Kosher King) belongs to an umbrella organisation. Its info@ is the
    // umbrella's inbox, not the shop's.
    let ownSite = !!siteDomain;
    try {
        const u = new URL(websiteUrl);
        const depth = u.pathname.split('/').filter(Boolean).length;
        const spellsName = nameWords.some(w => siteDomain.replace(/[^a-z0-9]/g, '').includes(w));
        ownSite = !!siteDomain && (depth <= 1 || spellsName);
    } catch { /* no website */ }

    const score = (e) => {
        const domain = registrableDomain(e.split('@')[1] || '');
        const squashed = domain.replace(/[^a-z0-9]/g, '');
        let s = 0;
        const local = (e.split('@')[0] || '').replace(/[^a-z0-9]/g, '');
        if (siteDomain && domain === siteDomain) s += ownSite ? 40 : 0;
        else if (FREEMAIL.test(e)) s += 15;
        else if (siteDomain) s -= 5;   // someone else's domain: usually the web agency
        if (domain !== siteDomain && AGENCY_DOMAIN.test(domain)) s -= 25;
        // A domain that spells the business name is the business's own.
        if (!FREEMAIL.test(e) && nameWords.some(w => squashed.includes(w))) s += 20;
        // "israelladen@mail.bgkorntal.de" for Israelladen: the shop's own inbox
        // on its parent organisation's server.
        if (nameWords.some(w => w.length >= 5 && local.includes(w))) s += 25;
        if (GOOD_PREFIX.test(e)) s += 10;
        if (BAD_PREFIX.test(e)) s -= 30;
        if (/^(pfarramt|sekretariat|verwaltung|poststelle|stadtverwaltung|buergerservice|servicecenter)@/.test(e)) s -= 15;
        return s;
    };
    return [...emails]
        .map((e, i) => ({ e, s: score(e), i }))
        .sort((a, b) => (b.s - a.s) || (a.i - b.i))
        .map(x => x.e);
}

// ─── Contact person ───────────────────────────────────────────────────────

const NAME_WORD = "[A-ZÄÖÜÉÈÀÂÇÎÏÔ][a-zäöüßéèêëáàâíìîïóòôúùûñçœ'’\\-]+";
const PARTICLE = '(?:von|van|der|den|de|du|des|le|la|ten|ter|zu|del|da|di|ben|bat|el|al)';
/** Forms of address in German, English, French and Dutch. */
const HONORIFIC = 'Frau|Herr|Fr\\.|Hr\\.|Mrs?\\.?|Ms\\.?|Miss|Madame|Mme\\.?|Monsieur|M\\.|Mevrouw|Mevr\\.|Dhr\\.|De heer';
const HONORIFIC_RE = new RegExp(`^(${HONORIFIC})\\s+`, 'i');
const FEMALE_HONORIFIC = /^(Frau|Fr\.|Mrs\.?|Ms\.?|Miss|Madame|Mme\.?|Mevrouw|Mevr\.)\s/i;
const MALE_HONORIFIC = /^(Herr|Hr\.|Mr\.?|Monsieur|M\.|Dhr\.|De heer)\s/i;
const NAME = `(?:(?:${HONORIFIC})\\s+)?(?:(?:Dr|Prof|Dipl\\.-\\w+)\\.?\\s+)*${NAME_WORD}(?:\\s+(?:${PARTICLE}\\s+)?${NAME_WORD}){1,3}`;

/** Labels, in order of how directly they name the person to address. */
const ROLE_LABELS = [
    'Inhaberin', 'Inhaber', 'Inh\\.', 'Geschäftsführerin', 'Geschäftsführer', 'Geschäftsführung',
    'Vertreten durch(?: die| den)?(?: Geschäftsführer(?:in)?| Inhaber(?:in)?)?',
    'Vertretungsberechtigte[rn]? (?:Geschäftsführer(?:in)?|Gesellschafter(?:in)?|Person)',
    'Owner', 'Proprietor', 'Managing Director', 'Director', 'Co-?[Ff]ounder', 'Founder', 'CEO', 'Represented by',
    'Verantwortlich(?: für den Inhalt)?(?: nach| gemäß| gem\\.| i\\.S\\.d\\.)?(?: §+ ?\\d+[^:]{0,30})?',
    'V\\.i\\.S\\.d\\.P\\.', 'Ansprechpartner(?:in)?', 'Kontaktperson',
    // France: "Mentions légales" name the publication director or manager.
    'Direct(?:eur|rice) de (?:la )?publication', 'Responsable de (?:la )?publication',
    'Gérante', 'Gérant', 'Propriétaire', 'Fondatrice', 'Fondateur', 'Présidente', 'Président',
    'Directrice', 'Directeur',
    // Belgium (Dutch).
    'Zaakvoerster', 'Zaakvoerder', 'Eigenares', 'Eigenaar', 'Bestuurder', 'Verantwoordelijke uitgever',
];

/** Words that look like names but are really the next label or a company. */
const NOT_A_NAME = /\b(Ltd|Limited|Registered|Company|Director|Founder|England|Wales|London|VAT|Sitz|Kontaktformular|Anrede|Plattform|Online|Redaktion|Leitung|Postanschrift|Hausanschrift|Postfach|Mobil|Handy|Web|Internet|Website|Webseite|Homepage|Hinweis|Datenschutz|Konzept|Gestaltung|Umsetzung|Kontaktdaten|Firma|Name|Vorname|Nachname|Evangelische|Katholische|Jüdische|Bibliothek|GmbH|UG|AG|KG|OHG|GbR|e\.K|e\.V|Straße|Strasse|Str\.|Platz|Weg|Allee|Telefon|Tel|Fax|E-Mail|Email|Mail|Registergericht|Amtsgericht|Handelsregister|Umsatzsteuer|USt|Steuernummer|Kontakt|Anschrift|Adresse|Impressum|Deutschland|Germany|Berlin|München|Hamburg|Köln|Frankfurt|Shop|Laden|Galerie|Verlag|Buchhandlung|Judaica|Museum|Gemeinde|Stiftung|Haftung|Inhalt|Inhalte|Angaben|Gemäß|Verantwortlich|Shopping|Account|Wish|Wishlist|Cart|Checkout|Login|Menu|Search|Store|Collections?|Products?|Customer|Orders?|Shipping|Returns|Privacy|Policy|Terms)\b/i;

/**
 * French and Dutch field labels and company words that follow a name in a
 * legal notice. Unicode-aware, because \\b does not see "Société" end.
 */
const NOT_A_NAME_EU = /^(Team|Équipe|Equipe|Staff|Service|SARL|SAS|SASU|EURL|SCI|SNC|SIRET|SIREN|RCS|TVA|Capital|Hébergeur|Hébergement|Téléphone|Tél\.?|Courriel|France|Paris|Belgique|België|Belgium|Bruxelles|Brussel|Antwerpen|BV|BVBA|SRL|SPRL|NV|ASBL|VZW|KBO|BTW|Ondernemingsnummer|Numéro|Contactez|Mentions|Publication|Rédaction|Siège|Société|Boutique|Librairie|Winkel|Boekhandel|Uitgever|Telefoon|Adres|Rue|Avenue|Av\.|Boulevard|Bd|Place|Quai|Chaussée|Allée|Impasse|Cours)[,.:]?$/iu;

/** "Fasanenstraße" is a compound, so \\bStraße misses it; "Str" may lose its dot. */
const STREET_WORD = /(straße|strasse|str\.?|platz|allee|gasse|weg|straat|laan|lei|plein|steenweg|kaai|dreef)[,.]?$/i;
/** Street suffixes that are also surname endings, trusted only from the third word on. */
const LATE_STREET_WORD = /(ring|damm|ufer|chaussee|steig|pfad|markt)[,.]?$/i;
/** Compounds naming an organisation: "Brüdergemeinde", "Literaturhandlung". */
const ORG_WORD = /(gemeinde|verein|verband|gesellschaft|stiftung|kirche|bibliothek|museum|verlag|handlung|zentrum|institut|amt|schule|galerie|laden|shop)[,.]?$/i;

/**
 * Job titles that sit in front of the name ("Direktorin Hetty Berg"). They are
 * stripped from the name and kept as the role, which also tells us the form
 * of address: "-in" titles are feminine.
 */
const TITLE_WORD = /^(Gérante|Gérant|Directrice|Directeur|Fondatrice|Fondateur|Présidente|Président|Propriétaire|Zaakvoerster|Zaakvoerder|Eigenares|Eigenaar|Bestuurder|Direktorin|Direktor|Leiterin|Leiter|Geschäftsführerin|Geschäftsführer|Inhaberin|Inhaber|Präsidentin|Präsident|Vorsitzender?|Vorständin|Vorstand|Gesellschafterin|Gesellschafter|Intendantin|Intendant|Kuratorin|Kurator|Rabbinerin|Rabbiner|Rabbi|Owner|Director|Chairman|Chair)$/;

/**
 * Capitalised German function words. NAME_WORD happily matches "Die" in
 * "…Hetty Berg Die Stiftung…" — a sentence starting straight after the name,
 * once the markup between them is stripped.
 */
const FUNCTION_WORD = /^(Die|Der|Das|Den|Dem|Des|Ein|Eine|Einen|Und|Oder|Sowie|Sie|Wir|Ihr|Es|Er|Im|In|Am|An|Auf|Aus|Zum|Zur|Für|Mit|Bei|Nach|Über|Unter|Als|Alle|Diese|Dieser|The|And|Of|For|Le|La|Les|Un|Une|Et|Ou|Pour|Avec|Dans|Sur|Par|Het|Een|En|Voor|Met)$/;

/** Roles that say which form of address to use. */
const FEMALE_ROLE = /(Gérante|Directrice|Fondatrice|Présidente|Zaakvoerster|Eigenares|Inhaberin|Geschäftsführerin|Direktorin|Leiterin|Präsidentin|Vorständin|Gesellschafterin|Intendantin|Kuratorin|Rabbinerin)$/;

/**
 * The person named in an Impressum, and the role they were named under.
 * "Geschäftsführer: Max Muster, Anna Beispiel" → first person.
 * @returns {{ name: string, role: string }}
 */
export function extractContact(text) {
    const t = clean(String(text || '').replace(/\u00a0/g, ' '));
    for (const label of ROLE_LABELS) {
        const re = new RegExp(`(?:^|[\\s.;,|])(${label})\\s*(?:\\(in\\))?\\s*[:\\-–]?\\s*(${NAME})`, 'u');
        const m = t.match(re);
        if (!m) continue;
        const { name, title } = tidyName(m[m.length - 1]);
        if (!name) continue;
        const fromLabel = (m[1].match(/(Inhaberin|Inhaber|Geschäftsführerin|Geschäftsführer|Gérante|Gérant|Directrice|Directeur|Fondatrice|Fondateur|Présidente|Président|Zaakvoerster|Zaakvoerder|Eigenares|Eigenaar)/) || [''])[0];
        return { name, role: title || fromLabel };
    }
    return { name: '', role: '' };
}

export function extractContactName(text) {
    return extractContact(text).name;
}

function tidyName(raw) {
    const words = clean(raw).split(' ');
    let title = '';
    // A job title in front is the role, not part of the name.
    while (words.length && TITLE_WORD.test(words[0])) title = words.shift();
    const kept = [];
    for (const w of words) {
        if (STREET_WORD.test(w) || (kept.length >= 2 && LATE_STREET_WORD.test(w))) {
            // "Oranienburger Str" — the word before a street is its name.
            // "Jan Peeters Lange Kievitstraat": past two words, the word
            // before a street is part of the street, not the name.
            if (kept.length && (/er$/.test(kept[kept.length - 1]) || kept.length > 2)) kept.pop();
            break;
        }
        // "Online-" is the first half of "Online-Redaktion" on the next line.
        if (NOT_A_NAME.test(w) || NOT_A_NAME_EU.test(w) || ORG_WORD.test(w) || FUNCTION_WORD.test(w) || TITLE_WORD.test(w) || /\d/.test(w) || /-$/.test(w)) break;
        kept.push(w);
    }
    const name = kept.join(' ');
    const core = name.replace(HONORIFIC_RE, '').replace(/^((Dr|Prof)\.?\s+)+/i, '');
    if (core.split(' ').filter(Boolean).length < 2) return { name: '', title: '' };
    return { name, title };
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
    if (!n) return shortBusinessName(biz) ? `Dear ${shortBusinessName(biz)} Team` : 'Dear Sir or Madam';
    const female = FEMALE_HONORIFIC.test(n) || FEMALE_ROLE.test(role);
    // "Inhaber: Irene Jaworski" — the masculine form is used generically, so
    // only an explicit Herr makes it "Mr.". The feminine forms are specific.
    const male = MALE_HONORIFIC.test(n);
    const bare = n.replace(HONORIFIC_RE, '')
        .replace(/(^|\s)(Dipl\.-?\s?[\wäöü]+\.?|M\.\s?A\.|B\.\s?A\.|Mag\.)(?=\s)/g, ' ').trim();
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

/**
 * The name a person would use for the shop, not its Maps SEO title:
 *   "Israel Spezialitäten | Die besten Medjoul Datteln | Dieterich" → "Israel Spezialitäten"
 *   "MIO GIO Therapy Cosmetics I Kosher Food I Judaica"          → "MIO GIO Therapy Cosmetics"
 *   "KosherStar GbR" → "KosherStar",  "JEWERIA® - Jewish jewelry" → "JEWERIA"
 */
export function shortBusinessName(name) {
    let n = clean(name)
        .replace(/[®™©]/g, '')
        // A Hebrew (or other non-Latin) word standing on its own is a translation of the name.
        .replace(/(^|\s)[\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Arabic}\u200e\u200f\s]+$/u, '');
    // "Contacts | Premium Kosher": a page-title word before the real name.
    const segs = n.split(/\s+[|–—]\s+|\s+-\s+|\s+I\s+|\s*\|\s*/).filter(Boolean);
    n = (segs.length > 1 && /^(contacts?|accueil|home|welcome|bienvenue|startseite|kontakt)$/i.test(segs[0].trim())) ? segs[1] : segs[0] || '';
    n = n.replace(/[,\s]+(GmbH\s*&\s*Co\.?\s*KG|GmbH|GbR|UG(\s*\(haftungsbeschränkt\))?|AG|KG|OHG|e\.\s?K\.?|Inh\..*|SARL|SASU|SAS|EURL|SRL|SPRL|BVBA|BV|NV)$/i, '');
    return clean(n);
}

/** Which role label the name was found under — used to infer the salutation. */
export function extractContactRole(text) {
    const m = clean(text).match(/\b(Inhaberin|Inhaber|Geschäftsführerin|Geschäftsführer|Owner|Managing Director)\b/);
    return m ? m[1] : '';
}

// ─── Link discovery ───────────────────────────────────────────────────────

// Hebrew: צור קשר / צרו קשר / יצירת קשר (contact), אודות (about); %d7%a6%d7%95%d7%a8 is צור in a URL.
const CONTACT_LINK = /(impressum|imprint|legal[-_ ]?notice|kontakt|contact|about|ueber[-_]?uns|über[-_]?uns|uber[-_]?uns|wir|team|anbieterkennzeichnung|צור קשר|צרו קשר|יצירת קשר|אודות|%d7%a6%d7%95%d7%a8|%d7%90%d7%95%d7%93%d7%95%d7%aa)/i;

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
export const GERMAN_CONTACT_PATHS = ['/impressum', '/kontakt', '/impressum/', '/pages/impressum', '/imprint'];
/** UK sites have no Impressum; the address lives on the contact page. */
export const ENGLISH_CONTACT_PATHS = ['/contact', '/contact-us', '/pages/contact', '/about', '/about-us'];

export function guessContactUrls(baseUrl, paths = GERMAN_CONTACT_PATHS) {
    try {
        const o = new URL(baseUrl).origin;
        return paths.map(p => `${o}${p}`);
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
    acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8',
    // Trunk code for national numbers found on a site ("WhatsApp 0176 …").
    phoneCode: '49',
    // Which page must be found (linked or guessed) before giving up on a site.
    keyPage: 'impressum|imprint|legal',
    guessPaths: GERMAN_CONTACT_PATHS,
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

    /** Fetch a page: { body, url } where url is where redirects ended, or null. */
    async _fetch(url, result) {
        const res = await this.http.fetchText(url, { headers: { 'Accept-Language': this.opts.acceptLanguage } });
        if (this.opts.delayMs) await new Promise(r => setTimeout(r, this.opts.delayMs));
        if (result) result.pagesRead.push(`${url}${res.url && res.url !== url ? ' → ' + res.url : ''} (${res.ok && res.body ? res.status || 'ok' : 'failed ' + (res.status || res.error || '')})`);
        if (!res.ok || !res.body) return null;
        this.stats.pages++;
        return { body: res.body, url: res.url || url };
    }

    async _get(url, result) {
        const r = await this._fetch(url, result);
        return r ? r.body : null;
    }

    /** The same page drawn by a real browser (JavaScript sites). */
    async _fetchRendered(url, result) {
        const res = await this.http.fetchRendered(url);
        if (result) result.pagesRead.push(`${url} (rendered${res.ok && res.body ? '' : ': failed ' + (res.error || res.status || '')})`);
        if (!res.ok || !res.body) return null;
        this.stats.pages++;
        return { body: res.body, url: res.url || url };
    }

    /** Returns { emails, contactName, contactRole, siteText, social } and applies them to `lead`. */
    async enrich(lead) {
        const site = clean(lead.website);
        const result = { emails: [], contactName: '', contactRole: '', siteText: '', social: {}, whatsapp: { numbers: [], linked: false, mentioned: false }, pagesRead: [], finalSite: '' };
        if (lead.email) result.emails.push(lead.email);

        let host = '';
        try { host = new URL(site).hostname.replace(/^www\./, ''); } catch { /* no website */ }
        if (/(^|\.)(wa\.me|wa\.link|whatsapp\.com)$/i.test(host)) {
            // The listing's "website" is a WhatsApp chat link: that is the evidence.
            const wa = extractWhatsApp(site, this.opts.phoneCode);
            result.whatsapp = { numbers: wa.numbers, linked: true, mentioned: true };
        } else if (site && /^https?:\/\//i.test(site) && !PLATFORM_DOMAIN.test(host)) {
            this.stats.sites++;
            const first = await this._fetch(site, result);
            const home = first && first.body;
            // Where the link really leads: Maps lists 1800eichlers.com, the
            // shop lives at eichlers.com. Its contact links are on the new
            // domain, so that is the base — unless it is a platform page.
            let base = site;
            try {
                const landed = first && new URL(first.url);
                if (landed && /^https?:$/.test(landed.protocol) && !PLATFORM_DOMAIN.test(landed.hostname)) base = landed.toString();
            } catch { /* keep the listed URL */ }
            result.finalSite = base !== site ? base : '';
            const pages = [];
            const tried = new Set([norm(site), norm(base)]);
            if (home) {
                pages.push(home);
                this._absorb(home, result);
                const links = findContactLinks(home, base, { max: this.opts.maxPagesPerSite });
                const hasKeyPage = links.some(u => new RegExp(this.opts.keyPage, 'i').test(u));
                const guesses = (this.opts.guessImpressum && !hasKeyPage) ? guessContactUrls(base, this.opts.guessPaths).slice(0, 2) : [];
                for (const url of [...links, ...guesses].slice(0, this.opts.maxPagesPerSite)) {
                    tried.add(norm(url));
                    const body = await this._get(url, result);
                    if (!body) continue;
                    pages.push(body);
                    this._absorb(body, result);
                    // Stop early once we have both an address and a person.
                    if (result.emails.length && result.contactName) break;
                }
            }
            // The Maps link is often not the homepage: a branch page
            // ("eichlers.com/pages/brooklyn"), a link with tracking codes, or a
            // page that failed to load. When it gave no address, try the
            // site's own homepage and contact pages — but only on the shop's
            // own site, never an umbrella organisation's (its info@ is not
            // the shop's).
            if (!result.emails.length && ownWebsite(base, lead.business_name)) {
                const root = new URL(base).origin + '/';
                const queue = [root, ...guessContactUrls(base, this.opts.guessPaths)];
                let budget = this.opts.maxPagesPerSite;
                while (queue.length && budget > 0 && !result.emails.length) {
                    const url = queue.shift();
                    if (tried.has(norm(url))) continue;
                    tried.add(norm(url));
                    budget--;
                    const body = await this._get(url, result);
                    if (!body) continue;
                    pages.push(body);
                    this._absorb(body, result);
                    // The homepage links the real contact page: try it next.
                    if (url === root) queue.unshift(...findContactLinks(body, root, { max: 2 }));
                }
            }
            // Some sites send an empty app shell and draw everything with
            // JavaScript: 1800eichlers.com answered 200 to /contact, /about
            // and /pages/contact-us alike, with almost no text. Read those in
            // the browser, as a visitor would see them.
            if (!result.emails.length && pages.length && looksLikeAppShell(pages)
                && typeof this.http.fetchRendered === 'function' && this.opts.renderShells !== false) {
                const shown = await this._fetchRendered(base, result);
                if (shown) {
                    pages.push(shown.body);
                    this._absorb(shown.body, result);
                    for (const link of findContactLinks(shown.body, shown.url, { max: 2 })) {
                        if (result.emails.length) break;
                        const r = await this._fetchRendered(link, result);
                        if (r) { pages.push(r.body); this._absorb(r.body, result); }
                    }
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
        const wa = extractWhatsApp(html, this.opts.phoneCode);
        for (const n of wa.numbers) if (!result.whatsapp.numbers.includes(n)) result.whatsapp.numbers.push(n);
        result.whatsapp.linked = result.whatsapp.linked || wa.linked;
        result.whatsapp.mentioned = result.whatsapp.mentioned || wa.mentioned;
        if (!result.contactName) {
            const text = stripHtml(html);
            const c = extractContact(text);
            result.contactName = c.name;
            result.contactRole = c.role;
        }
    }
}

/**
 * Is this an app shell — markup that JavaScript fills in later? Almost no
 * visible text on the homepage, or several different addresses returning the
 * very same page (the app's catch-all route).
 */
export function looksLikeAppShell(pages) {
    const texts = pages.map(p => stripHtml(p).replace(/\s+/g, ' ').trim());
    if (texts[0].length < 400) return true;
    return pages.length >= 3 && new Set(pages).size === 1;
}

/** A URL without its tracking codes, fragment and trailing slash, for "already fetched?". */
function norm(url) {
    try {
        const u = new URL(url);
        return (u.origin + u.pathname).replace(/\/+$/, '').toLowerCase();
    } catch {
        return String(url || '');
    }
}

/**
 * Is this URL the shop's own website? Its homepage, or any page on a domain
 * that spells the shop's name ("eichlers.com" for Eichlers Judaica). A deep
 * page on another domain belongs to an umbrella organisation.
 */
export function ownWebsite(websiteUrl, businessName = '') {
    try {
        const u = new URL(websiteUrl);
        const domain = registrableDomain(u.hostname).replace(/[^a-z0-9]/g, '');
        if (!domain || PLATFORM_DOMAIN.test(u.hostname)) return false;
        if (u.pathname.split('/').filter(Boolean).length === 0) return true;
        return nameTokens(businessName).filter(t => t.length >= 4).some(w => domain.includes(w));
    } catch {
        return false;
    }
}

/**
 * An address on someone else's domain that names neither the shop nor its
 * website: the web designer (contact@sansoxygen.com for Judaica Creations),
 * an app vendor (support@gist-apps.com), the kosher certifier whose page
 * Maps linked (newapp@ou.org). Freemail and the site's own domain are never
 * third-party, and neither is anything when the website is a platform page.
 */
export function isThirdPartyEmail(email, websiteUrl, businessName = '') {
    if (FREEMAIL.test(email)) return false;
    const [local = '', host = ''] = String(email).split('@');
    const domain = registrableDomain(host);
    let site = '';
    try {
        const h = new URL(websiteUrl).hostname;
        if (PLATFORM_DOMAIN.test(h)) return false;
        site = registrableDomain(h);
    } catch { return false; }
    if (!domain || !site || domain === site) return false;
    const hay = (domain + local).replace(/[^a-z0-9]/g, '');
    const words = nameTokens(businessName).filter(t => t.length >= 4);
    const siteWord = site.split('.')[0].replace(/[^a-z0-9]/g, '');
    return !words.some(w => hay.includes(w)) && !(siteWord.length >= 4 && hay.includes(siteWord));
}

/** The shop's email (best-ranked that is not third-party) and up to three others. */
export function pickEmail(ranked, websiteUrl, businessName = '') {
    const own = ranked.filter(e => !isThirdPartyEmail(e, websiteUrl, businessName));
    const third = ranked.filter(e => isThirdPartyEmail(e, websiteUrl, businessName));
    return { email: own[0] || '', others: [...own.slice(1), ...third].slice(0, 3) };
}

/** Write an enrichment result onto the lead row. */
export function applyContacts(lead, result) {
    // Rank against where the website really is (after redirects).
    const site = result.finalSite || lead.website;
    const { email, others } = pickEmail(rankEmails(result.emails, site, lead.business_name), site, lead.business_name);
    lead.email = email || lead.email || '';
    lead.other_emails = others.join('; ');
    if (result.contactName) {
        lead.contact_name = result.contactName;
        lead.contact_role = result.contactRole || '';
    }
    lead.facebook_url = lead.facebook_url || result.social.facebook || '';
    lead.instagram_url = lead.instagram_url || result.social.instagram || '';
    lead._siteText = result.siteText || '';
    if (result.whatsapp) {
        lead.whatsapp_site_numbers = result.whatsapp.numbers.join('; ');
        lead.whatsapp_site_linked = !!result.whatsapp.linked;
        lead.whatsapp_mentioned = !!result.whatsapp.mentioned;
    }
    return lead;
}
