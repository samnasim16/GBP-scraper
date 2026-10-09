/**
 * Input loading, the German city list, the Judaica search terms, and the
 * query matrix.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** Load .env without requiring dotenv. */
export function loadDotEnv(cwd = process.cwd()) {
    try {
        const envPath = path.resolve(cwd, '.env');
        if (!fs.existsSync(envPath)) return;
        for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
            if (!m) continue;
            const val = m[2].trim().replace(/^["']|["']$/g, '');
            if (!(m[1] in process.env)) process.env[m[1]] = val;
        }
    } catch { /* a missing or unreadable .env is not fatal */ }
}

/**
 * German cities, grouped by Bundesland.
 *
 * Judaica retail follows the Jewish communities, so beyond the largest cities
 * this deliberately includes smaller places with an active Gemeinde, a Jewish
 * museum or a historic Jewish quarter (Worms, Speyer, Fürth, Erfurt, Halberstadt,
 * Bamberg…) — museum shops and gift shops there are exactly the target.
 */
export const GERMAN_CITIES = {
    BE: ['Berlin'],
    HH: ['Hamburg'],
    HB: ['Bremen', 'Bremerhaven'],
    BY: ['München', 'Nürnberg', 'Fürth', 'Augsburg', 'Regensburg', 'Würzburg',
         'Bamberg', 'Bayreuth', 'Erlangen', 'Ingolstadt', 'Passau', 'Hof', 'Straubing', 'Amberg'],
    BW: ['Stuttgart', 'Mannheim', 'Karlsruhe', 'Freiburg im Breisgau', 'Heidelberg',
         'Ulm', 'Heilbronn', 'Pforzheim', 'Konstanz', 'Baden-Baden', 'Esslingen am Neckar', 'Tübingen'],
    HE: ['Frankfurt am Main', 'Wiesbaden', 'Kassel', 'Darmstadt', 'Offenbach am Main',
         'Gießen', 'Marburg', 'Fulda', 'Hanau', 'Bad Nauheim'],
    NW: ['Köln', 'Düsseldorf', 'Dortmund', 'Essen', 'Duisburg', 'Bochum', 'Wuppertal',
         'Bielefeld', 'Bonn', 'Münster', 'Gelsenkirchen', 'Aachen', 'Mönchengladbach',
         'Krefeld', 'Oberhausen', 'Hagen', 'Recklinghausen', 'Paderborn', 'Minden', 'Herford'],
    NI: ['Hannover', 'Braunschweig', 'Osnabrück', 'Oldenburg', 'Göttingen',
         'Wolfsburg', 'Hildesheim', 'Celle', 'Lüneburg'],
    RP: ['Mainz', 'Worms', 'Speyer', 'Trier', 'Koblenz', 'Ludwigshafen am Rhein', 'Kaiserslautern', 'Bad Kreuznach'],
    SL: ['Saarbrücken'],
    SH: ['Kiel', 'Lübeck', 'Flensburg'],
    MV: ['Rostock', 'Schwerin', 'Greifswald'],
    BB: ['Potsdam', 'Cottbus', 'Frankfurt (Oder)'],
    SN: ['Leipzig', 'Dresden', 'Chemnitz', 'Görlitz', 'Zwickau'],
    ST: ['Magdeburg', 'Halle (Saale)', 'Dessau-Roßlau', 'Halberstadt'],
    TH: ['Erfurt', 'Weimar', 'Jena', 'Gera', 'Eisenach'],
};

/**
 * The biggest cities hide their shops behind Google's per-query result cap
 * (roughly 120 places). Searching their Jewish-life districts separately
 * surfaces the small shops that otherwise sit below the cut.
 */
export const CITY_DISTRICTS = {
    Berlin: ['Charlottenburg', 'Wilmersdorf', 'Mitte', 'Prenzlauer Berg', 'Schöneberg', 'Kreuzberg', 'Steglitz'],
    'München': ['Altstadt-Lehel', 'Maxvorstadt', 'Schwabing', 'Bogenhausen'],
    'Frankfurt am Main': ['Innenstadt', 'Westend', 'Sachsenhausen', 'Nordend'],
    Hamburg: ['Altstadt', 'Eimsbüttel', 'Rotherbaum', 'Altona'],
};

/**
 * Search terms, German first — Maps answers best in the language of the place.
 * The first ones are the high-yield terms and run first across every city, so
 * a run cut short has already covered the country with them.
 */
export const DEFAULT_CATEGORIES = [
    'Judaica',
    'Judaica Geschäft',
    'jüdische Geschenke',
    'jüdischer Buchladen',
    'Israel Geschenke',
    'Jüdisches Museum Shop',
    'koscher Laden',
    'Menora kaufen',
    'Glaskunst Geschenke',
    'Kunstglas Galerie',
];

/** Terms that run first everywhere before the long tail starts. */
export const HIGH_YIELD = ['Judaica', 'Judaica Geschäft', 'jüdische Geschenke', 'Israel Geschenke'];

/**
 * English cities, grouped by region.
 *
 * As in Germany, Judaica retail follows the communities: North-West London
 * and Hertfordshire (Borehamwood, Radlett, Bushey), North Manchester
 * (Prestwich, Whitefield, Broughton Park), Leeds, Gateshead, and the seaside
 * communities (Brighton & Hove, Bournemouth, Southend/Westcliff).
 */
export const ENGLAND_CITIES = {
    LDN: ['London'],
    EE:  ['Borehamwood', 'Radlett', 'Bushey', 'Watford', 'St Albans', 'Southend-on-Sea', 'Westcliff-on-Sea',
          'Chelmsford', 'Colchester', 'Cambridge', 'Norwich', 'Ipswich', 'Luton', 'Peterborough'],
    SE:  ['Brighton', 'Hove', 'Southampton', 'Portsmouth', 'Reading', 'Milton Keynes', 'Oxford',
          'Canterbury', 'Guildford', 'Windsor', 'Maidstone', 'Tunbridge Wells', 'Winchester'],
    NW:  ['Manchester', 'Salford', 'Bury', 'Stockport', 'Altrincham', 'Liverpool', 'Southport',
          'Chester', 'Preston', 'Blackpool', 'Lancaster'],
    NE:  ['Newcastle upon Tyne', 'Gateshead', 'Sunderland', 'Durham', 'Middlesbrough'],
    YH:  ['Leeds', 'Sheffield', 'Bradford', 'York', 'Harrogate', 'Hull'],
    WM:  ['Birmingham', 'Solihull', 'Coventry', 'Wolverhampton', 'Stratford-upon-Avon'],
    EM:  ['Nottingham', 'Leicester', 'Derby', 'Northampton', 'Lincoln'],
    SW:  ['Bristol', 'Bath', 'Bournemouth', 'Exeter', 'Plymouth', 'Cheltenham', 'Gloucester', 'Salisbury'],
};

export const ENGLAND_DISTRICTS = {
    London: ['Golders Green', 'Hendon', 'Temple Fortune', 'Finchley', 'Stamford Hill', 'Edgware', 'Stanmore',
             'Mill Hill', 'Hampstead', "St John's Wood", 'Swiss Cottage', 'Highgate', 'Ilford', 'Woodford',
             'Pinner', 'Kensington', 'Mayfair', 'Covent Garden', 'Camden'],
    Manchester: ['Prestwich', 'Whitefield', 'Broughton Park', 'Cheetham Hill', 'Didsbury', 'Hale'],
};

export const ENGLAND_CATEGORIES = [
    'Judaica',
    'Judaica shop',
    'Jewish gift shop',
    'Jewish bookshop',
    'Israeli products',
    'Jewish museum shop',
    'kosher shop',
    'kosher deli',
    'Menorah',
    'art glass gallery',
];

/**
 * French cities, grouped by region.
 *
 * France has Europe's largest Jewish population. Beyond Paris and its
 * north-eastern suburbs (Sarcelles, Saint-Brice, Créteil, Saint-Mandé,
 * Vincennes, Neuilly, Boulogne), the communities are in Marseille, Lyon,
 * Nice, Strasbourg (and Alsace), Toulouse and Montpellier.
 */
export const FRANCE_CITIES = {
    IDF: ['Paris', 'Sarcelles', 'Saint-Brice-sous-Forêt', 'Garges-lès-Gonesse', 'Créteil', 'Saint-Mandé',
          'Vincennes', 'Neuilly-sur-Seine', 'Boulogne-Billancourt', 'Levallois-Perret', 'Le Raincy',
          'Montreuil', 'Versailles', 'Saint-Germain-en-Laye', 'Aubervilliers'],
    PACA: ['Marseille', 'Nice', 'Cannes', 'Antibes', 'Aix-en-Provence', 'Toulon', 'Avignon'],
    ARA: ['Lyon', 'Villeurbanne', 'Grenoble', 'Saint-Étienne', 'Annecy', 'Clermont-Ferrand'],
    GES: ['Strasbourg', 'Metz', 'Nancy', 'Mulhouse', 'Colmar', 'Reims', 'Troyes'],
    OCC: ['Toulouse', 'Montpellier', 'Nîmes', 'Perpignan'],
    NAQ: ['Bordeaux', 'Biarritz', 'Pau', 'Limoges', 'Poitiers', 'La Rochelle'],
    HDF: ['Lille', 'Roubaix', 'Amiens'],
    NOR: ['Rouen', 'Le Havre', 'Caen'],
    BRE: ['Rennes', 'Brest'],
    PDL: ['Nantes', 'Angers'],
    CVL: ['Tours', 'Orléans'],
    BFC: ['Dijon', 'Besançon'],
};

export const FRANCE_DISTRICTS = {
    Paris: ['Le Marais', '4e arrondissement', '9e arrondissement', '11e arrondissement', '16e arrondissement',
            '17e arrondissement', '19e arrondissement', '20e arrondissement', 'Belleville'],
    Marseille: ['Castellane', 'Le Prado', 'Saint-Just'],
};

export const FRANCE_CATEGORIES = [
    'Judaica',
    'Boutique Judaica',
    'Cadeaux juifs',
    'Librairie juive',
    'Articles religieux juifs',
    'Épicerie casher',
    'Magasin casher',
    'Menorah',
    'Art juif',
    'Verrerie d\'art',
];

/**
 * Belgian cities. Antwerp's Orthodox community (around the diamond district)
 * is one of the largest in Europe; Brussels' is spread over Uccle, Forest,
 * Saint-Gilles, Ixelles and Anderlecht. Search terms mix Dutch and French.
 */
export const BELGIUM_CITIES = {
    BRU: ['Bruxelles'],
    VLG: ['Antwerpen', 'Gent', 'Brugge', 'Leuven', 'Mechelen', 'Hasselt', 'Kortrijk', 'Oostende', 'Knokke-Heist'],
    WAL: ['Liège', 'Charleroi', 'Namur', 'Mons', 'Waterloo', 'Arlon'],
};

export const BELGIUM_DISTRICTS = {
    Bruxelles: ['Uccle', 'Forest', 'Saint-Gilles', 'Ixelles', 'Anderlecht', 'Woluwe-Saint-Lambert', 'Schaerbeek', 'Etterbeek'],
    Antwerpen: ['Diamantwijk', 'Zurenborg', 'Berchem', 'Wilrijk'],
};

export const BELGIUM_CATEGORIES = [
    'Judaica',
    'Judaica winkel',
    'Boutique Judaica',
    'Joodse geschenken',
    'Cadeaux juifs',
    'Joodse boekhandel',
    'Librairie juive',
    'Koosjer winkel',
    'Épicerie casher',
    'Menorah',
];

/**
 * Everything that differs between the markets. `gl` sets the country Maps
 * searches in; `phoneCode` is what a national number starting with 0 gets;
 * `foreign` drops cross-border results.
 */
export const COUNTRIES = {
    DE: {
        name: 'Germany',
        gl: 'de',
        phoneCode: '49',
        regionLabel: 'Bundesland',
        regions: GERMAN_CITIES,
        districts: CITY_DISTRICTS,
        categories: DEFAULT_CATEGORIES,
        highYield: HIGH_YIELD,
        acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8',
        contactKeyPage: 'impressum|imprint|legal',
        contactPaths: ['/impressum', '/kontakt', '/impressum/', '/pages/impressum', '/imprint'],
        outputDir: 'output',
        foreign: /,\s*(Austria|Österreich|Switzerland|Schweiz|Suisse|France|Frankreich|Netherlands|Niederlande|Nederland|Belgium|Belgien|Poland|Polen|Czechia|Czech Republic|Tschechien|Denmark|Dänemark|Luxembourg|Luxemburg|Italy|Italien|Israel|United Kingdom|UK|USA|United States)\s*$/i,
    },
    UK: {
        name: 'England',
        gl: 'uk',
        phoneCode: '44',
        regionLabel: 'region',
        regions: ENGLAND_CITIES,
        districts: ENGLAND_DISTRICTS,
        categories: ENGLAND_CATEGORIES,
        highYield: ['Judaica', 'Judaica shop', 'Jewish gift shop', 'Jewish bookshop'],
        acceptLanguage: 'en-GB,en;q=0.9',
        // No Impressum in the UK: the contact page carries the address.
        contactKeyPage: 'contact',
        contactPaths: ['/contact', '/contact-us', '/pages/contact', '/about', '/about-us'],
        outputDir: 'output-uk',
        // The Republic of Ireland and the Continent; Scotland, Wales and
        // Northern Ireland are the UK and stay.
        foreign: /,\s*(Ireland|Éire|Co\.\s*\w+|France|Netherlands|Belgium|Germany|Deutschland|Spain|Israel|USA|United States)\s*$/i,
    },
    FR: {
        name: 'France',
        gl: 'fr',
        phoneCode: '33',
        regionLabel: 'région',
        regions: FRANCE_CITIES,
        districts: FRANCE_DISTRICTS,
        categories: FRANCE_CATEGORIES,
        highYield: ['Judaica', 'Boutique Judaica', 'Cadeaux juifs', 'Librairie juive'],
        acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8',
        // French sites must carry "Mentions légales", naming the
        // "directeur de la publication" — the French Impressum.
        contactKeyPage: 'mentions|legal|contact',
        contactPaths: ['/mentions-legales', '/contact', '/mentions-legales/', '/nous-contacter', '/pages/contact'],
        outputDir: 'output-fr',
        // Monaco and Andorra are their own countries.
        foreign: /(,\s*(Belgium|Belgique|Switzerland|Suisse|Schweiz|Luxembourg|Germany|Allemagne|Deutschland|Spain|Espagne|Italy|Italie|Monaco|Andorra|Andorre|United Kingdom|UK|Israel|Israël)|\b980\d\d\s+Monaco)\s*$/i,
    },
    BE: {
        name: 'Belgium',
        gl: 'be',
        phoneCode: '32',
        regionLabel: 'region',
        regions: BELGIUM_CITIES,
        districts: BELGIUM_DISTRICTS,
        categories: BELGIUM_CATEGORIES,
        highYield: ['Judaica', 'Judaica winkel', 'Boutique Judaica', 'Joodse geschenken'],
        acceptLanguage: 'nl-BE,nl;q=0.9,fr-BE;q=0.8,fr;q=0.7,en;q=0.6',
        contactKeyPage: 'mentions|legal|contact|colofon|disclaimer',
        contactPaths: ['/contact', '/mentions-legales', '/nl/contact', '/fr/contact', '/colofon'],
        outputDir: 'output-be',
        foreign: /,\s*(France|Netherlands|Nederland|Pays-Bas|Germany|Deutschland|Allemagne|Duitsland|Luxembourg|Luxemburg|United Kingdom|UK|Israel)\s*$/i,
    },
};

/** "DE", "UK", "GB", "England" → a COUNTRIES entry (default Germany). */
export function resolveCountry(input = {}) {
    const raw = String(input.country || 'DE').trim().toUpperCase();
    const code = {
        GB: 'UK', ENGLAND: 'UK', 'UNITED KINGDOM': 'UK', GERMANY: 'DE', DEUTSCHLAND: 'DE',
        FRANCE: 'FR', BELGIUM: 'BE', BELGIQUE: 'BE', 'BELGIË': 'BE', BELGIE: 'BE',
    }[raw] || raw;
    const c = COUNTRIES[code];
    if (!c) throw new Error(`Unknown country "${input.country}". Use one of: ${Object.keys(COUNTRIES).join(', ')}`);
    return { code, ...c };
}

/**
 * Which config file to read.
 * `--input <path>` works identically on every platform; `INPUT_FILE=...` is a
 * bash-ism that silently fails in cmd.exe, so the flag is the documented way.
 */
export function resolveInputPath(argv = process.argv.slice(2)) {
    for (let i = 0; i < argv.length; i++) {
        if ((argv[i] === '--input' || argv[i] === '-i') && argv[i + 1]) {
            return path.resolve(process.cwd(), argv[i + 1]);
        }
        const inline = argv[i].match(/^--input=(.+)$/);
        if (inline) return path.resolve(process.cwd(), inline[1]);
    }
    if (process.env.INPUT_FILE) return path.resolve(process.cwd(), process.env.INPUT_FILE);
    return path.resolve(process.cwd(), 'input.json');
}

export function loadInput(log = console.log) {
    const file = resolveInputPath();
    try {
        if (fs.existsSync(file)) {
            log(`📄 Reading config: ${file}`);
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        log(`📄 No config at ${file} — using built-in defaults (all of Germany).`);
        log('   To customise, copy the example and edit it:');
        log(process.platform === 'win32'
            ? '     copy input.example.json input.json'
            : '     cp input.example.json input.json');
    } catch (e) {
        console.error(`⚠️  Could not parse ${file} (${e.message}) — using defaults.`);
    }
    return {};
}

/**
 * Turn the raw config into a concrete list of { state, city } searches.
 *
 *   states: ["BE","BY"]  — only those Bundesländer (empty = all of Germany)
 *   cities: ["Worms"]    — an explicit list, which replaces the built-in one
 *   districts: true      — also search the big cities district by district
 */
export function resolveLocations(input = {}, log = console.log) {
    const { states = [], cities = [], districts = true } = input;
    const country = resolveCountry(input);
    const REGIONS = country.regions;
    const DISTRICTS = country.districts;
    const out = [];
    const push = (state, city) => out.push({ state, city });

    if (Array.isArray(cities) && cities.length > 0) {
        for (const c of cities) {
            const city = String(c).trim();
            if (city) push('', city);
        }
    } else {
        const wanted = (Array.isArray(states) && states.length > 0)
            ? states.map(s => String(s).trim().toUpperCase())
            : Object.keys(REGIONS);
        for (const code of wanted) {
            const list = REGIONS[code];
            if (!list) { log(`⚠️  Unknown ${country.regionLabel} "${code}" — skipping. Known: ${Object.keys(REGIONS).join(', ')}`); continue; }
            for (const city of list) push(code, city);
        }
    }

    if (districts) {
        for (const loc of [...out]) {
            for (const d of DISTRICTS[loc.city] || []) push(loc.state, `${d}, ${loc.city}`);
        }
    }
    return out;
}

/** Build the query matrix, high-yield terms first across every location. */
export function buildQueryMatrix(locations, categories, highYield = HIGH_YIELD) {
    const rank = (cat) => {
        const i = highYield.indexOf(cat);
        return i === -1 ? highYield.length : i;
    };
    const queries = [];
    for (const loc of locations) {
        for (const cat of categories) {
            queries.push({ text: `${cat} ${loc.city}`, category: cat, city: loc.city, state: loc.state });
        }
    }
    // Stable sort: within a rank, locations keep their order.
    return queries
        .map((q, i) => ({ q, i }))
        .sort((a, b) => (rank(a.q.category) - rank(b.q.category)) || (a.i - b.i))
        .map(x => x.q);
}
