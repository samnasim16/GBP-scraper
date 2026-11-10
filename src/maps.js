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
import { extractWhatsApp } from './whatsapp.js';

import { COUNTRIES } from './config.js';
import { marketOfAddress } from './europe.js';

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
 *   FR  "10 Rue des Rosiers, 75004 Paris"             → Paris
 *   BE  "Lange Kievitstraat 1, 2018 Antwerpen"        → Antwerpen (4-digit postcode)
 *   US  "4920 13th Ave, Brooklyn, NY 11219"           → Brooklyn (town before "ST 12345")
 * and the art campaign's markets beyond Europe (see worldPlace).
 */
export function cityFromAddress(address, countryCode = 'DE') {
    const parts = addressParts(address);
    if (!parts.length) return '';
    if (WORLD_PLACE.has(countryCode)) return worldPlace(address, countryCode).city;
    if (countryCode === 'IL') {
        // "King George St 20, Jerusalem, 9414205" / "HaMelacha St 39, Holon":
        // the town is the last part once the 7-digit postcode is gone.
        for (let i = parts.length - 1; i >= 0; i--) {
            const town = parts[i].replace(/\b\d{5,7}\b/g, '').trim();
            if (town && !/\d/.test(town)) return town;
            if (i < parts.length - 1 || !/^\d{5,7}$/.test(parts[i])) return '';
        }
        return '';
    }
    if (countryCode === 'US') {
        for (let i = parts.length - 1; i > 0; i--) {
            if (US_STATE_ZIP.test(parts[i]) && !/\d/.test(parts[i - 1])) return parts[i - 1];
        }
        return '';
    }
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
    if (countryCode === 'DE' || countryCode === 'BE' || countryCode === 'FR') {
        for (let i = parts.length - 1; i >= 0; i--) {
            const m = parts[i].match(/^\d{4,5}\s+(.+)$/);
            if (m) return m[1].trim();
        }
        return '';
    }
    return europeTown(parts);
}

/**
 * The rest of Europe. A postcode before the town: "1100-053 Lisboa",
 * "00-950 Warszawa", "1012 LG Amsterdam", "111 51 Stockholm", "L-1724
 * Luxembourg", "20121 Milano MI", "110 00 Praha 1", "MD-2001 Chișinău".
 * After it: "Athina 105 63", "Beograd 11000". Alone after the town:
 * "Budapest, 1052", "Dublin 2, D02 X285", "Rīga, LV-1010"; alone before it:
 * "Ilica 1, 10000, Zagreb", "Rruga e Durrësit, 1001, Tiranë". Lithuania
 * names the municipality after the postcode ("Vilnius, 01103 Vilniaus m.
 * sav."), so the town is the part before it. A house number ("23 Dawson
 * St") is not a postcode.
 */
function europeTown(parts) {
    // "Milano MI", "Praha 1", "København K".
    const tidy = (t) => t.replace(/\s+([A-Z]{2}|\d{1,2}|[A-ZÆØÅ])$/u, '').trim();
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (/(?:^|\s)sav\.?$|savivaldyb\p{L}*$/iu.test(p)) {
            const town = i > 0 ? tidy(parts[i - 1]) : '';
            if (town && !/\d/.test(town)) return town;
            continue;
        }
        const before = p.match(/^(?:[A-Z]{1,2}-)?(?:\d{4,6}|\d{3} \d{2}|\d{2}-\d{3}|\d{4}-\d{3})(?:\s+[A-Z]{2}(?=\s))?\s+(\p{L}[\p{L}\s.'’-]*?(?:\s+[A-Z]{2}|\s+\d{1,2})?)$/u);
        if (before) return tidy(before[1]);
        const after = p.match(/^(\p{L}[\p{L}\s.'’-]*?)\s+(?:\d{3} \d{2}|\d{4,6})$/u);
        if (after) return after[1].trim();
        if (/^(?:\d{4,6}|[A-Z]\d{2}\s?[A-Z\d]{4}|[A-Z]{2}-\d{4,5})$/.test(p)) {
            const next = i + 1 < parts.length ? tidy(parts[i + 1]) : '';
            if (next && !/\d/.test(next)) return next;
            const town = i > 0 ? tidy(parts[i - 1]) : '';
            if (town && !/\d/.test(town)) return town;
        }
    }
    return '';
}

const US_STATE_ZIP = /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/;

/** Country names at the end of an address (not the city-states: "Singapore 018989", "Monaco", "Hong Kong" are towns too). */
const COUNTRY_PART = /^(germany|deutschland|united kingdom|uk|england|france|belgium|belgique|belgië|belgie|united states|usa|us|israel|ישראל|switzerland|schweiz|suisse|italy|italia|spain|españa|netherlands|the netherlands|nederland|austria|österreich|sweden|sverige|denmark|danmark|norway|norge|ireland|portugal|japan|south korea|korea|republic of korea|taiwan|india|united arab emirates|uae|australia|new zealand|canada|mexico|méxico|brazil|brasil|argentina|colombia|south africa|bulgaria|croatia|cyprus|czechia|czech republic|estonia|finland|greece|hungary|latvia|lithuania|malta|poland|romania|slovakia|slovenia|iceland|liechtenstein|andorra|serbia|bosnia and herzegovina|montenegro|north macedonia|albania|kosovo|moldova|ukraine|türkiye|turkey|qatar|saudi arabia|kuwait|lebanon|chile|peru|uruguay|thailand|indonesia|philippines|malaysia|vietnam|viet nam|nigeria|kenya|egypt|morocco|ghana)$/i;

function addressParts(address) {
    return String(address || '').split(',').map(p => p.trim()).filter(Boolean).filter(p => !COUNTRY_PART.test(p));
}

/**
 * Town and region beyond Europe and the US, for the art campaign's world run
 * (Maps' English UI):
 *   JP  "6 Chome-10-1 Roppongi, Minato City, Tokyo 106-6108"  → Tokyo, Tokyo
 *       (Tokyo's wards are "… City"; "Kita Ward, Osaka, 530-0001" → Osaka;
 *       "Naka Ward, Yokohama, Kanagawa 231-0023" → Yokohama, Kanagawa)
 *   KR  "54 Samcheong-ro, Jongno-gu, Seoul 03053"             → Seoul
 *   HK  "G/F, 50 Connaught Rd Central, Central, Hong Kong"    → Hong Kong (no postcode)
 *   SG  "1 Fullerton Rd, #02-01, Singapore 049213"            → Singapore
 *   TW  "No. 1號, Zhongzheng District, Taipei City, 100"       → Taipei
 *   IN  "Kala Ghoda, Fort, Mumbai, Maharashtra 400001"        → Mumbai, Maharashtra
 *   AE  "Al Quoz - Al Quoz Industrial Area 1 - Dubai"         → Dubai, Dubai (" - " between parts)
 *   AU  "2 Danks St, Waterloo NSW 2017"                       → Waterloo, NSW (a suburb: pickCity keeps Sydney)
 *   CA  "1 Spadina Ave, Toronto, ON M5V 2T6"                  → Toronto, ON
 *   MX  "Colima 196, Roma Nte., Cuauhtémoc, 06700 Ciudad de México, CDMX" → Ciudad de México, CDMX
 *   BR  "R. Oscar Freire, 379 - Jardins, São Paulo - SP, 01426-001"      → São Paulo, SP
 *   AR  "Av. Alvear 1891, C1129 CABA"                         → Buenos Aires
 *   CO  "Cl. 10 #5-51, La Candelaria, Bogotá, Cundinamarca"   → Bogotá, Cundinamarca
 * and the countries added later (the region is the province, oblast,
 * department, state or governorate the address names):
 *   HU  "Budapest, Falk Miksa u. 10, 1055"                    → Budapest (the town first; "Váci u. 1, Budapest, 1052" too)
 *   MT  "Republic St, Valletta VLT 1117"                      → Valletta
 *   IS  "Laugavegur 1, 101 Reykjavík"                         → Reykjavík (3-digit postcode)
 *   AD  "Av. Meritxell, 25, AD500 Andorra la Vella"           → Andorra la Vella
 *   UA  "Rynok Square, 1, Lviv, Lviv Oblast, 79000"           → Lviv, Lviv Oblast
 *   TR  "Meşrutiyet Cd. No:99, 34430 Beyoğlu/İstanbul"        → İstanbul, İstanbul ("48400 Bodrum/Muğla" → Bodrum, Muğla)
 *   SA  "Prince Mohammed Bin Abdulaziz Rd, Al Olaya, Riyadh 12241" → Riyadh
 *   QA, KW, LB, KE, GH: the last part that names a place     → Doha, Salmiya (Hawalli), Beirut, Nairobi, Accra
 *   CL  "Alonso de Córdova 3053, 7630000 Vitacura, Región Metropolitana" → Vitacura, Región Metropolitana (a commune: pickCity keeps Santiago)
 *   PE  "Av. Pedro de Osma 135, Barranco 15063"               → Barranco (a district: pickCity keeps Lima)
 *   UY  "Calle 20, 20100 Punta del Este, Departamento de Maldonado" → Punta del Este, Maldonado
 *   TH  "Khwaeng Bang Rak, Khet Bang Rak, Krung Thep Maha Nakhon 10500" → Bangkok, Bangkok
 *   ID  "Kec. Mampang Prpt., Kota Jakarta Selatan, Daerah Khusus Ibukota Jakarta 12730" → Jakarta, Jakarta
 *       ("Kecamatan Ubud, Kabupaten Gianyar, Bali 80571" → Ubud, Bali)
 *   PH  "2316 Chino Roces Ave Ext, Makati, 1231 Metro Manila"  → Makati, Metro Manila
 *   MY  "Bukit Bintang, 55100 Kuala Lumpur, Wilayah Persekutuan Kuala Lumpur" → Kuala Lumpur, Kuala Lumpur
 *   VN  "Bến Nghé, Quận 1, Thành phố Hồ Chí Minh 700000"       → Ho Chi Minh City
 *   NG  "1 Akin Adesola St, Victoria Island, Lagos 106104, Lagos" → Lagos, Lagos
 *   EG  "1 Mohammed Mazhar, Zamalek, Cairo Governorate 4271130" → Cairo, Cairo
 *   MA  "Rue Yves Saint Laurent, Marrakech 40090"             → Marrakech
 * New Zealand ("Auckland 1010"), South Africa ("Cape Town, 8001") and the
 * other European countries read as Europe does (europeTown).
 */
const WORLD_PLACE = new Set(['JP', 'KR', 'HK', 'SG', 'TW', 'IN', 'AE', 'AU', 'CA', 'MX', 'BR', 'AR', 'CO',
    'HU', 'MT', 'IS', 'AD', 'UA', 'TR', 'QA', 'SA', 'KW', 'LB', 'CL', 'PE', 'UY', 'TH', 'ID', 'PH', 'MY', 'VN', 'NG', 'KE', 'EG', 'MA', 'GH']);
const AU_TOWN = /^(\p{L}[\p{L} .'’-]*?)\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)(?:\s+\d{4})?$/u;
const CA_PROVINCE = /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)(?:\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d)?$/;
/** Each emirate's town as Maps writes it, and the emirate (Al Ain is in Abu Dhabi). */
const UAE_TOWNS = { dubai: ['Dubai', 'Dubai'], 'abu dhabi': ['Abu Dhabi', 'Abu Dhabi'], 'al ain': ['Al Ain', 'Abu Dhabi'], sharjah: ['Sharjah', 'Sharjah'],
    ajman: ['Ajman', 'Ajman'], 'ras al khaimah': ['Ras Al Khaimah', 'Ras Al Khaimah'], fujairah: ['Fujairah', 'Fujairah'], 'umm al quwain': ['Umm Al Quwain', 'Umm Al Quwain'] };
const KR_CITY = /^(Seoul|Busan|Incheon|Daegu|Daejeon|Gwangju|Ulsan|Sejong)(?:-si|\s+City)?$/i;
const CO_DEPARTMENT = /^(Amazonas|Antioquia|Arauca|Atlántico|Bolívar|Boyacá|Caldas|Caquetá|Casanare|Cauca|Cesar|Chocó|Córdoba|Cundinamarca|Guainía|Guaviare|Huila|La Guajira|Magdalena|Meta|Nariño|Norte de Santander|Putumayo|Quindío|Risaralda|San Andrés|Santander|Sucre|Tolima|Valle del Cauca|Vaupés|Vichada)$/i;

/** Hungarian street words (and the district, "V. kerület"): not the town. */
const HU_STREET = /(?:^|\s)(?:út|utca|u\.|tér|tere|körút|krt\.?|sor|rakpart|rkp\.?|köz|sétány|fasor|lépcső|liget|park|udvar|dűlő|kerület|ker\.)$/iu;
/** Türkiye's big cities, whose districts ("Beyoğlu/İstanbul", "Çankaya/Ankara") are parts of the city; elsewhere the district is the town ("Bodrum/Muğla"). */
const TR_METRO = /^(?:İstanbul|Istanbul|Ankara|İzmir|Izmir|Bursa)$/iu;
/** An admin area after the town: "Hawalli Governorate", "Makkah Province", "Greater Accra Region", "Nairobi County", "Lagos State", "Lviv Oblast". */
const ADMIN_AREA = /^(\p{L}[\p{L} .'’-]*?)\s+(?:Governorate|Province|Region|County|State|Oblast)$/iu;
/** Egypt's governorates that are one city: the town is the governorate ("Zamalek, Cairo Governorate" → Cairo). */
const EG_CITY = /^(?:Cairo|Giza|Alexandria|Luxor|Aswan|Port Said|Suez|Ismailia|Damietta)$/i;
/** Metro Manila's cities, which Maps sometimes writes "Makati City". */
const PH_CITY = /^(Makati|Taguig|Pasig|Pasay|Mandaluyong|Manila|Muntinlupa|Parañaque|Marikina|San Juan|Caloocan|Las Piñas|Valenzuela|Navotas|Malabon) City$/i;

/**
 * The town in an address with no postcode before it: the last part that is
 * a place, after dropping postcodes ("Riyadh 12241", "Nairobi, 00100"),
 * Ghana's digital addresses (GA-123-4567) and the admin area, which is the
 * region ("Salmiya, Hawalli Governorate" → Salmiya, Hawalli).
 */
function lastTown(parts, postcode = /\s+\d{4,7}(?:[\s-]\d{4})?$/) {
    let region = '';
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i].replace(postcode, '').trim();
        if (!p || /^\d[\d\s-]*$/.test(p) || /^[A-Z]{2}-\d{3,4}-\d{3,4}$/.test(p)) continue;
        const admin = p.match(ADMIN_AREA);
        if (admin) { if (!region) region = admin[1]; continue; }
        if (/\d/.test(p)) break;
        return { city: p, region };
    }
    return { city: '', region };
}

export function worldPlace(address, countryCode) {
    const parts = addressParts(address);
    const place = (city = '', region = '') => ({ city: clean(city), region: clean(region) });
    if (!parts.length) return place();
    switch (countryCode) {
    case 'HK': return place('Hong Kong');
    case 'SG': return place('Singapore');
    case 'AU':
        for (let i = parts.length - 1; i >= 0; i--) {
            const m = parts[i].match(AU_TOWN);
            if (m) return place(m[1], m[2]);
        }
        return place();
    case 'CA':
        for (let i = parts.length - 1; i > 0; i--) {
            const m = parts[i].match(CA_PROVINCE);
            if (m && !/\d/.test(parts[i - 1])) return place(parts[i - 1], m[1]);
        }
        return place();
    case 'BR':
        // "São Paulo - SP" (or "- State of São Paulo"); "379 - Jardins" is the street.
        for (let i = parts.length - 1; i >= 0; i--) {
            const m = parts[i].match(/^(\p{L}[^\d]*?)\s+-\s+(?:State of\s+)?([A-Z]{2}|\p{Lu}[\p{L} ]+)$/u);
            if (m) return place(m[1], m[2]);
        }
        return place();
    case 'IN':
        // "Mumbai, Maharashtra 400001": the state before the 6-digit PIN, the town before it.
        for (let i = parts.length - 1; i >= 0; i--) {
            const m = parts[i].match(/^(\p{L}[\p{L} .&-]*?)\s+\d{6}$/u);
            if (m) return place(i > 0 && !/\d/.test(parts[i - 1]) ? parts[i - 1] : '', m[1]);
        }
        return place();
    case 'AE': {
        const segs = String(address || '').split(/,|\s[-–]\s/).map(p => p.trim()).filter(Boolean);
        for (let i = segs.length - 1; i >= 0; i--) {
            const t = UAE_TOWNS[segs[i].toLowerCase()];
            if (t) return place(t[0], t[1]);
        }
        return place();
    }
    case 'JP': {
        let i = parts.findLastIndex(p => /\b\d{3}-\d{4}\b/.test(p));
        if (i === -1) return place();
        let pref = parts[i].replace(/\b\d{3}-\d{4}\b/, '').trim();
        // "Kyoto, 605-0074": the postcode stands alone after the prefecture.
        if (!pref && i > 0) pref = parts[--i];
        pref = String(pref || '').replace(/\s+Prefecture$/i, '');
        if (!pref || /\d/.test(pref)) return place();
        let j = i - 1;
        // A district (gun) between the town and the prefecture: "3419 Naoshima, Kagawa District, Kagawa".
        const gun = j >= 0 && /\sDistrict$|-gun$/i.test(parts[j]);
        if (gun) j--;
        const prev = j >= 0 ? parts[j] : '';
        const village = gun && prev.replace(/^(?:[\d-]+\s+)+/, '').trim();
        if (village && !/\d/.test(village)) return place(village, pref);
        // Tokyo's wards are "… City"; the big cities' wards "… Ward" before the city.
        if (!prev || /\d|ch[oō]me/i.test(prev) || /\s(?:City|Ward)$|-ku$/i.test(prev)) return place(pref, pref);
        return place(prev, pref);
    }
    case 'KR': {
        let region = '';
        const ps = parts.map(p => p.replace(/\s+\d{5}$/, '')).filter(p => !/^\d{5}$/.test(p));
        for (let i = ps.length - 1; i >= 0; i--) {
            const p = ps[i];
            if (/-do$|\sProvince$/i.test(p)) { region = p; continue; }
            if (/\d|-(?:gu|gun|dong|ro|gil|eup|myeon)$|\sDistrict$/i.test(p)) break;
            return place(p.replace(/-si$|\s+City$/i, ''), region);
        }
        // "Seoul, Jongno-gu, Samcheong-ro, 54": the city first.
        const city = ps.find(p => KR_CITY.test(p));
        return place(city ? city.replace(/-si$|\s+City$/i, '') : '', region);
    }
    case 'TW': {
        // "…, Taipei City, 100", "…, Taipei, Taiwan 110": the postcode (and country) last.
        const ps = parts.filter(p => !/^(?:Taiwan\s+)?\d{3,6}$/i.test(p)).map(p => p.replace(/\s+\d{3,6}$/, ''));
        for (let i = ps.length - 1; i >= 0; i--) {
            const m = ps[i].match(/^(\p{L}[\p{L} '’-]*?)\s+(?:City|County)$/u);
            if (m) return place(m[1]);
            if (/\d|\sDistrict$/i.test(ps[i])) break;
            return place(ps[i]);
        }
        return place();
    }
    case 'MX':
        // "06700 Ciudad de México, CDMX": the town after its postcode, the state after it.
        for (let i = parts.length - 1; i >= 0; i--) {
            const m = parts[i].match(/^\d{5}\s+(\p{L}.*)$/u);
            if (m) return place(m[1], parts[i + 1] && !/\d/.test(parts[i + 1]) ? parts[i + 1] : '');
        }
        return place();
    case 'AR': {
        // "C1129 CABA", "C1005AAU Cdad. Autónoma de Buenos Aires", "B1640 Martínez".
        const town = (t) => (/^(?:CABA|C\.A\.B\.A\.|Cdad\.? Autónoma de Buenos Aires|Ciudad Autónoma de Buenos Aires)$/i.test(t) ? 'Buenos Aires' : t);
        for (let i = parts.length - 1; i >= 0; i--) {
            const m = parts[i].match(/^[A-Z]?\d{4}(?:[A-Z]{3})?\s+(\p{L}.*)$/u);
            if (m) return place(town(m[1].trim()));
        }
        const last = parts[parts.length - 1];
        return place(/\d/.test(last) ? '' : town(last));
    }
    case 'CO': {
        let region = '';
        const ps = parts.map(p => p.replace(/\s+\d{6}$/, '')).filter(p => !/^\d{6}$/.test(p));
        for (let i = ps.length - 1; i >= 0; i--) {
            const p = ps[i];
            if (/^D\.?\s?C\.?$/i.test(p)) continue;
            if (CO_DEPARTMENT.test(p) && i > 0) { region = p; continue; }
            if (/\d|#/.test(p)) break;
            return place(p.replace(/,?\s*D\.?\s?C\.?$/i, ''), region);
        }
        return place('', region);
    }
    case 'HU': {
        const ps = parts.map(p => p.replace(/\s+Hungary$/i, '').trim()).filter(Boolean);
        // "1055 Budapest, Falk Miksa u. 10": a postcode before the town.
        const before = ps.map(p => p.match(/^\d{4}\s+(\p{L}[\p{L} .'’-]*)$/u)).find(Boolean);
        if (before) return place(before[1]);
        // "Budapest, Falk Miksa u. 10, 1055" (Hungary's order) or "Váci u. 1, Budapest, 1052".
        return place(ps.filter(p => !/\d/.test(p) && !HU_STREET.test(p)).pop());
    }
    case 'MT':
        // "Valletta VLT 1117": a three-letter, four-digit postcode after the town.
        for (let i = parts.length - 1; i >= 0; i--) {
            const m = parts[i].match(/^(\p{L}[\p{L} .'’-]*?)\s+[A-Z]{3}\s?\d{4}$/u);
            if (m) return place(m[1]);
        }
        return place(europeTown(parts) || lastTown(parts).city);
    case 'IS':
    case 'AD':
        // "101 Reykjavík" (a 3-digit postcode), "AD500 Andorra la Vella".
        for (let i = parts.length - 1; i >= 0; i--) {
            const m = parts[i].match(countryCode === 'IS' ? /^\d{3}\s+(\p{L}.*)$/u : /^AD\s?\d{3}\s+(\p{L}.*)$/u);
            if (m) return place(m[1]);
        }
        return place(europeTown(parts));
    case 'UA': {
        // "Lviv, Lviv Oblast, 79000": the oblast is the region; "Kyiv, 02000".
        const oblast = parts.find(p => /\s(?:Oblast|область)$/iu.test(p)) || '';
        return place(lastTown(parts.filter(p => p !== oblast)).city, oblast);
    }
    case 'TR':
        // "34430 Beyoğlu/İstanbul": the district, then the province.
        for (let i = parts.length - 1; i >= 0; i--) {
            const m = parts[i].match(/^(?:\d{5}\s+)?(\p{L}[^/\d]*?)\s*\/\s*(\p{L}[^/\d]*?)$/u);
            if (m) return place(TR_METRO.test(m[2].trim()) ? m[2] : m[1], m[2]);
        }
        return place(europeTown(parts));
    case 'QA':
    case 'SA':
    case 'KW':
    case 'LB':
    case 'KE':
    case 'GH': {
        const t = lastTown(parts);
        return place(t.city, t.region);
    }
    case 'EG': {
        // "Zamalek, Cairo Governorate 4271130": a city governorate is the town.
        const t = lastTown(parts);
        return place(EG_CITY.test(t.region) ? t.region : t.city, t.region);
    }
    case 'MA':
        // "Marrakech 40090" or "40000 Marrakech" as in Europe; "Gueliz, Marrakech".
        return place(europeTown(parts) || lastTown(parts).city);
    case 'CL': {
        // "7630000 Vitacura, Región Metropolitana" (or "Santiago Metropolitan Region").
        let region = '';
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            if (/^Regi[oó]n\b|\sRegion$/iu.test(p)) { region = region || p; continue; }
            const town = p.replace(/^\d{7}\s+/, '');
            if (/\d/.test(town)) break;
            return place(town, region);
        }
        return place('', region);
    }
    case 'PE':
    case 'NG': {
        // "Barranco 15063" (Peru), "Lagos 106104, Lagos" (Nigeria): the town
        // before its postcode; the region (department, state) after it.
        for (let i = parts.length - 1; i >= 0; i--) {
            const m = parts[i].match(countryCode === 'PE' ? /^(\p{L}[^\d]*?)\s+\d{5}$/u : /^(\p{L}[^\d]*?)\s+\d{6}$/u);
            if (m) return place(m[1], parts[i + 1] && !/\d/.test(parts[i + 1]) ? parts[i + 1].replace(/\s+State$/i, '') : '');
        }
        const t = lastTown(parts);
        return place(t.city, t.region);
    }
    case 'UY': {
        // "20100 Punta del Este, Departamento de Maldonado" (or "Maldonado Department").
        let region = '';
        for (let i = parts.length - 1; i >= 0; i--) {
            const dep = parts[i].match(/^Departamento de\s+(.+)$|^(.+?)\s+Department$/i);
            if (dep) { region = region || dep[1] || dep[2]; continue; }
            const town = parts[i].replace(/^\d{5}\s+/, '');
            if (/\d/.test(town)) break;
            return place(town, region);
        }
        return place('', region);
    }
    case 'TH': {
        // "…, Krung Thep Maha Nakhon 10500" (Bangkok), "…, Mueang Chiang Mai District, Chiang Mai 50200",
        // "…, Amphoe Mueang Chiang Mai, Chang Wat Chiang Mai 50300"; in Thai, "…กรุงเทพมหานคร 10500".
        if (/กรุงเทพ|Krung Thep|Bangkok/i.test(address)) return place('Bangkok', 'Bangkok');
        const province = parts[parts.length - 1].replace(/\s*\d{5}$/, '').replace(/^Chang Wat\s+|^จ(?:ังหวัด|\.)\s*/i, '').trim();
        if (!province || /\d/.test(province)) return place();
        const district = parts.slice(0, -1).map(p => p.match(/^Amphoe\s+(.+)$|^(.+?)\s+District$/i)).filter(Boolean).pop();
        const town = district ? (district[1] || district[2]).replace(/^Mueang\s+/i, '') : province;
        return place(/\d/.test(town) ? province : town, province);
    }
    case 'ID': {
        // The province before the postcode: "Daerah Khusus Ibukota Jakarta 12730", "Bali 80571".
        const jakarta = (t) => (/\bJakarta\b/i.test(t) ? 'Jakarta' : /\bYogyakarta\b/i.test(t) ? 'Yogyakarta' : t.trim());
        const last = parts[parts.length - 1].replace(/\s*\d{5}$/, '').trim();
        const region = last && !/\d/.test(last) && parts.length > 1 ? jakarta(last) : '';
        const admin = parts.slice(0, region ? -1 : undefined);
        // A city (Kota) is the town; in a regency (Kabupaten) the kecamatan is:
        // "Kecamatan Ubud, Kabupaten Gianyar", "Ubud, Gianyar Regency".
        for (let i = admin.length - 1; i >= 0; i--) {
            const m = admin[i].match(/^Kota(?:\s+Administrasi)?\s+(\p{L}.*)$|^(\p{L}.*?)\s+City$/iu);
            if (m) return place(jakarta(m[1] || m[2]), region);
        }
        for (let i = admin.length - 1; i >= 0; i--) {
            const m = admin[i].match(/^(?:Kecamatan|Kec\.)\s+(\p{L}.*)$/iu);
            if (m) return place(m[1], region);
        }
        const k = admin.findIndex(p => /^(?:Kabupaten|Kab\.)\s|\sRegency$/i.test(p));
        if (k > 0 && !/\d|^(?:Jl\.|Jalan|Gg\.)/i.test(admin[k - 1])) return place(admin[k - 1], region);
        if (region === 'Jakarta' || region === 'Yogyakarta') return place(region, region);
        return place(lastTown(admin).city, region);
    }
    case 'PH': {
        // "Makati, 1231 Metro Manila": the province or region after its postcode, the city before it.
        const city = (t) => t.replace(PH_CITY, '$1');
        const last = parts[parts.length - 1].match(/^(?:(\d{4})\s+)?(\p{L}.*)$/u);
        if (last && parts.length > 1 && (last[1] || /^(?:Metro Manila|NCR|National Capital Region)$/i.test(last[2]))) {
            const prev = parts[parts.length - 2];
            return place(/\d/.test(prev) ? '' : city(prev), last[2]);
        }
        return place(city(lastTown(parts).city));
    }
    case 'MY': {
        // "55100 Kuala Lumpur, Wilayah Persekutuan Kuala Lumpur", "47300 Petaling Jaya, Selangor".
        const state = (t) => t.replace(/^(?:Wilayah Persekutuan|Federal Territory of)\s+/i, '');
        for (let i = parts.length - 1; i >= 0; i--) {
            const m = parts[i].match(/^\d{5}\s+(\p{L}.*)$/u);
            if (m) return place(m[1], parts[i + 1] && !/\d/.test(parts[i + 1]) ? state(parts[i + 1]) : '');
        }
        const t = lastTown(parts);
        return place(t.city, t.region);
    }
    case 'VN': {
        // "Quận 1, Thành phố Hồ Chí Minh 700000", "District 1, Ho Chi Minh City", "Hoàn Kiếm, Hà Nội".
        const ps = parts.filter(p => !/^(?:Tỉnh|Tinh)\s/i.test(p));
        const province = parts.map(p => p.match(/^(?:Tỉnh|Tinh)\s+(.+)$/i)).filter(Boolean).pop();
        const t = lastTown(ps, /\s+\d{5,6}$/);
        const town = t.city.replace(/^(?:Thành phố|Thanh pho|TP\.?)\s*/i, '');
        const name = /^(?:Hồ Chí Minh|Ho Chi Minh(?: City)?|HCMC|Sài Gòn|Saigon)$/i.test(town) ? 'Ho Chi Minh City'
            : /^(?:Hà Nội|Ha Noi|Hanoi)$/i.test(town) ? 'Hanoi' : town;
        return place(name, (province && province[1]) || t.region);
    }
    default: return place();
    }
}

/** "…, Brooklyn, NY 11219" → "NY". Only US addresses carry the state. */
export function stateFromAddress(address) {
    const parts = addressParts(address);
    for (let i = parts.length - 1; i > 0; i--) {
        const m = parts[i].match(US_STATE_ZIP);
        if (m) return parts[i].slice(0, 2);
    }
    return '';
}

/**
 * The region column (`bundesland`) for a market whose profile sets
 * `regionInAddress`: the state, province or emirate the address names, and
 * nothing when it names none. Israeli addresses name no district, so an
 * Israeli row has none.
 */
export function regionFromAddress(address, countryCode) {
    if (countryCode === 'US') return stateFromAddress(address);
    if (WORLD_PLACE.has(countryCode)) return worldPlace(address, countryCode).region;
    return '';
}

/**
 * The City column. German Maps addresses (English UI) name the district, not
 * the city: "50823 Ehrenfeld", "01279 Dresden-Leuben". So in Germany the
 * address town wins only when it is itself one of the cities we search (the
 * shop really is in another city); a district, or "Dresden-Leuben", keeps
 * the searched city. UK addresses carry the real post town and always win.
 */
export function pickCity(address, queryCity, country = {}) {
    // "Borough Park, Brooklyn, NY" → "Brooklyn"; "Arad, Israel" → "Arad"; "Paris" stays "Paris".
    const searched = String(queryCity || '').replace(/,\s*[A-Z]{2}$/, '').replace(/,\s*Israel$/, '').replace(/^.*,\s*/, '');
    const town = cityFromAddress(address, country.code);
    if (!town) return searched;
    if (country.markets) {
        // "1368 Ville-Haute Luxembourg": a quarter before a city we search
        // (but New Taipei is not Taipei, nor East London London).
        const city = !/^(?:New|East|West|North|South|Little|Upper|Lower|Greater|Old|Port)\s/i.test(town)
            && Object.values(country.regions || {}).flat().find(c => town.endsWith(` ${c}`));
        if (city) return city;
    }
    // UK and US addresses carry the real post town.
    if ((country.addressTownWins && !country.districtTowns) || country.code === 'UK') return town;
    const norm = (x) => String(x).toLowerCase().replace(/\s*\(.*\)$/, '').replace(/ (am|im|an der) .*$/, '');
    if (norm(town).startsWith(norm(searched))) return searched;
    const known = new Set(Object.values(country.regions || {}).flat().map(norm));
    if (known.has(norm(town))) return town;
    // "Mannheim-Neckarstadt-West": a district of another searched city.
    const base = town.split('-')[0].trim();
    if (known.has(norm(base))) return base;
    return searched;
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
    const base = opts.country || DEFAULT_COUNTRY;
    // A many-country run (Europe) searches each place as its own country:
    // its Google region and its phone trunk code.
    const market = base.markets && base.markets[query.state];
    const country = market
        ? { ...base, code: query.state, gl: market.gl, phoneCode: market.phoneCode, trunks: market.trunks || ['0'], nationalLengths: market.nationalLengths, districtTowns: !!market.districtTowns }
        : base;
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
        // The website lookup opens shop sites in other tabs of this browser.
        // A tab in the background doesn't load more results when scrolled:
        // after "Sushi Berlin", every search showed only its first 7 places.
        await page.bringToFront().catch(() => {});
        // Scroll until the feed stops growing or Maps says it has run out.
        // Maps can take several seconds to load the next batch ("Sushi Berlin"
        // stopped at 14 places after one second without new cards), so the
        // feed has ended only when Maps says so or three checks in a row
        // find no new card.
        let last = -1;
        let stalls = 0;
        for (let i = 0; i < opts.maxScrolls; i++) {
            await page.evaluate(el => el.scrollBy(0, 2400), feed);
            await sleep(1500);
            if (await page.$('.HlvSq')) break;
            const n = await page.$$eval('div[role="feed"] a[href*="/maps/place/"]', els => els.length).catch(() => 0);
            if (n >= opts.maxResultsPerQuery) break;
            if (n === last) {
                if (++stalls >= 3) break;
                continue;
            }
            stalls = 0;
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
        if (!opts.keepNonProfits && !isSellable({ business_name: c.name, category: c.category, campaign: country.campaign }).ok) {
            drop.nonProfit++; continue;
        }
        // Cheap pre-screen: a kosher restaurant is not a Judaica buyer. Only
        // drop when the name carries no Judaica word at all. A campaign
        // (sushi) wants restaurants and drops its own tiers instead: a
        // supermarket's sushi counter, a fish shop. A verdict the website can
        // still overturn is kept for it to be read: "X Gallery & Framing" is
        // a gallery if its site shows exhibitions (art.js, `provisional`).
        let notBuyer;
        if (country.campaign) {
            const r = scoreRelevance({ business_name: c.name, category: c.category, campaign: country.campaign, country: country.code });
            notBuyer = !!country.dropAtFeed && country.dropAtFeed.includes(r.tier) && !r.provisional;
        } else {
            notBuyer = NON_RETAIL_CATEGORY.test(c.category) && scoreRelevance({ business_name: c.name }).tier !== 'Judaica seller';
        }
        if (c.category && notBuyer) {
            drop.notRetail++; continue;
        }
        if (opts.minReviews > 0 && c.reviewCount > 0 && c.reviewCount < opts.minReviews) { drop.reviews++; continue; }
        survivors.push({ ...c, pk, nk });
    }
    log(`  Feed: ${cards.length} places | new: ${survivors.length} | dropped — dup:${drop.dup} non-profit:${drop.nonProfit} ${country.dropLabel || (country.campaign ? 'not-restaurant' : 'not-retail')}:${drop.notRetail} closed:${drop.closed}${drop.reviews ? ` reviews:${drop.reviews}` : ''}`);

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

            const d = await page.evaluate(extractDetail, country.phoneCode, country.trunks || ['0'], country.nationalLengths || [10]);
            const name = clean(d.name) || c.name;
            if (!name) continue;
            const address = clean(d.address);
            if (country.foreign.test(address)) { log(`    ✗ Outside ${country.name}: ${name} (${address})`); continue; }
            if (country.foreignPhone && d.phone && country.foreignPhone.test(d.phone)) { log(`    ✗ Outside ${country.name}: ${name} (phone ${d.phone})`); continue; }

            const pk = c.pk || placeKey(page.url());
            const nk = nameKey(name, query.city);
            // Abroad, the address names its country (a Singapore search finds
            // Johor Bahru, Malaysia; Basel finds Weil am Rhein, Germany): read
            // it as that market's address, and its town wins, because the
            // searched city is in another country.
            const abroad = base.markets ? marketOfAddress(address, base.markets) : '';
            const reader = abroad && abroad !== country.code ? { ...country, code: abroad, districtTowns: false } : country;
            // The same place comes back from searches in many towns; key it by
            // the town in its address too, so it is kept once.
            const addrCity = pickCity(address, query.city, reader);
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
                city:               addrCity,
                // A US address names its state; a Teaneck search can return a Monsey shop.
                // Some campaigns take the region only from the address (art: Varnish shows it).
                bundesland:         country.regionInAddress ? regionFromAddress(address, reader.code)
                    : (country.stateInAddress && stateFromAddress(address)) || query.state,
                address:            address,
                category:           titleCase(clean(d.category) || clean(c.category)),
                rating:             rating ?? '',
                review_count:       d.reviews || c.reviewCount || 0,
                facebook_url:       '',
                instagram_url:      '',
                whatsapp_listing:   extractWhatsApp((d.whatsappUrls || []).join(' '), country.phoneCode).numbers.join('; '),
                maps_description:   clean(d.description),
                hours_summary:      clean(d.hoursSummary),
                maps_url:           c.href || page.url(),
                source_query:       query.text,
                country:            country.code,
                // The website lookup reads local numbers with this code.
                phone_code:         country.phoneCode,
                // Abroad, the address names the country: a Strasbourg search finds Kehl, Germany.
                country_name:       (base.markets && base.markets[abroad] || market || country).name,
                ...(country.campaign ? { campaign: country.campaign } : {}),
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

/**
 * The relevance columns, plus any fields a campaign adds (the art campaign's
 * art_type, accepts_submissions, submission_url… for the Varnish importer).
 */
export function relevanceFields(lead, siteText = '') {
    const r = scoreRelevance(lead, siteText);
    return { relevance_tier: r.tier, relevance_score: r.score, relevance_evidence: r.evidence, ...(r.fields || {}) };
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
