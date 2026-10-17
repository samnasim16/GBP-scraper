/**
 * Input loading, the German city list, the Judaica search terms, and the
 * query matrix.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');

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
 * United States, by state. Starts with the three biggest Jewish markets:
 * New York (Brooklyn — Borough Park, Williamsburg, Crown Heights, Flatbush —
 * Queens, the Five Towns, Monsey, Monroe/Kiryas Joel), New Jersey (Lakewood,
 * Teaneck/Bergen County, Passaic, Highland Park) and South Florida (Miami
 * Beach, Aventura, Hollywood, Boca Raton). Each city carries its state, so
 * "Judaica Lawrence, NY" is not searched in Kansas. Add a state by adding a
 * key here.
 */
export const US_CITIES = {
    NY: ['Manhattan, NY', 'Brooklyn, NY', 'Queens, NY', 'Bronx, NY', 'Staten Island, NY',
         'Lawrence, NY', 'Cedarhurst, NY', 'Woodmere, NY', 'Hewlett, NY', 'Great Neck, NY', 'West Hempstead, NY',
         'Oceanside, NY', 'Long Beach, NY', 'Plainview, NY', 'Roslyn, NY', 'Merrick, NY',
         'New Rochelle, NY', 'Scarsdale, NY', 'White Plains, NY', 'Yonkers, NY',
         'Monsey, NY', 'Spring Valley, NY', 'New City, NY', 'Monroe, NY', 'Kiryas Joel, NY', 'Monticello, NY',
         'Albany, NY', 'Rochester, NY', 'Buffalo, NY', 'Syracuse, NY'],
    NJ: ['Lakewood, NJ', 'Jackson, NJ', 'Toms River, NJ', 'Howell, NJ', 'Teaneck, NJ', 'Englewood, NJ',
         'Bergenfield, NJ', 'Fair Lawn, NJ', 'Paramus, NJ', 'Hackensack, NJ', 'Fort Lee, NJ', 'Passaic, NJ',
         'Clifton, NJ', 'Elizabeth, NJ', 'Highland Park, NJ', 'Edison, NJ', 'East Brunswick, NJ', 'Livingston, NJ',
         'West Orange, NJ', 'Deal, NJ', 'Long Branch, NJ', 'Morristown, NJ', 'Cherry Hill, NJ', 'Princeton, NJ',
         'Jersey City, NJ'],
    FL: ['Miami Beach, FL', 'Surfside, FL', 'Bal Harbour, FL', 'Sunny Isles Beach, FL', 'Aventura, FL',
         'North Miami Beach, FL', 'Miami, FL', 'Hollywood, FL', 'Hallandale Beach, FL', 'Fort Lauderdale, FL',
         'Plantation, FL', 'Weston, FL', 'Coral Springs, FL', 'Parkland, FL', 'Boca Raton, FL', 'Delray Beach, FL',
         'Boynton Beach, FL', 'West Palm Beach, FL', 'Palm Beach Gardens, FL', 'Jupiter, FL', 'Orlando, FL',
         'Tampa, FL', 'St. Petersburg, FL', 'Sarasota, FL', 'Naples, FL', 'Jacksonville, FL'],
};

export const US_DISTRICTS = {
    'Brooklyn, NY': ['Borough Park', 'Williamsburg', 'Crown Heights', 'Flatbush', 'Midwood', 'Marine Park',
                     'Sheepshead Bay', 'Brighton Beach', 'Mill Basin', 'Kensington'],
    'Manhattan, NY': ['Upper West Side', 'Upper East Side', 'Lower East Side', 'Washington Heights', 'Midtown'],
    'Queens, NY': ['Kew Gardens Hills', 'Forest Hills', 'Rego Park', 'Far Rockaway', 'Fresh Meadows',
                   'Jamaica Estates', 'Bayside'],
    'Bronx, NY': ['Riverdale'],
};

export const US_CATEGORIES = [
    'Judaica',
    'Judaica store',
    'Jewish gift shop',
    'Seforim store',
    'Jewish bookstore',
    'Israeli gifts',
    'Jewish museum shop',
    'kosher supermarket',
    'Menorah',
    'art glass gallery',
];

/**
 * Israel, by district. Judaica retail is densest in Jerusalem (Mea Shearim,
 * Geula, the Old City, Ben Yehuda / Mamilla for tourists), Bnei Brak (Rabbi
 * Akiva Street), Safed's artists' quarter, and the Haredi towns (Beit
 * Shemesh, Elad, Modi'in Illit, Beitar Illit). Gift and souvenir shops in
 * Tel Aviv-Jaffa, Eilat and Tiberias sell Judaica to tourists.
 */
export const ISRAEL_CITIES = {
    JM: ['Jerusalem', 'Beit Shemesh', 'Mevaseret Zion'],
    TA: ['Tel Aviv', 'Jaffa', 'Bnei Brak', 'Ramat Gan', 'Givatayim', 'Holon', 'Bat Yam', 'Herzliya', 'Ramat HaSharon'],
    CE: ['Petah Tikva', 'Rishon LeZion', 'Rehovot', 'Netanya', "Ra'anana", 'Kfar Saba', 'Hod HaSharon', "Modi'in",
         'Elad', 'Ness Ziona', 'Lod', 'Ramla', 'Rosh HaAyin', 'Yavne', 'Shoham'],
    HA: ['Haifa', 'Hadera', "Zikhron Ya'akov", 'Caesarea', 'Kiryat Ata', 'Kiryat Bialik'],
    NO: ['Safed', 'Tiberias', 'Nof HaGalil', 'Karmiel', 'Afula', 'Nahariya', 'Acre', 'Kiryat Shmona', "Ma'alot-Tarshiha"],
    SO: ["Be'er Sheva", 'Ashdod', 'Ashkelon', 'Eilat', 'Netivot', 'Ofakim', 'Kiryat Gat', 'Sderot', 'Dimona', 'Arad'],
    // Israeli towns in the West Bank with large religious communities.
    JS: ["Modi'in Illit", 'Beitar Illit', "Ma'ale Adumim", 'Efrat', 'Ariel', 'Kiryat Arba', 'Emmanuel'],
};

export const ISRAEL_DISTRICTS = {
    Jerusalem: ['Mea Shearim', 'Geula', 'Old City', 'Jewish Quarter', 'Ben Yehuda Street', 'Mamilla', 'Ramot', 'Har Nof', 'Bayit Vegan', 'Ramat Shlomo'],
    'Bnei Brak': ['Rabbi Akiva Street'],
    Safed: ['Artists Colony', 'Old City'],
    Jaffa: ['Old Jaffa', 'Jaffa Flea Market'],
    'Tel Aviv': ['Dizengoff', 'Nachalat Binyamin'],
};

// Hebrew first: most Israeli shops list themselves in Hebrew.
export const ISRAEL_CATEGORIES = [
    'יודאיקה',
    'Judaica',
    'תשמישי קדושה',
    'כלי קודש',
    'חנות יודאיקה',
    'ספרי קודש',
    'חנות מתנות',
    'Souvenir shop',
    'מזכרות',
    'Art glass gallery',
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
        script: 'start',
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
        script: 'england',
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
        script: 'france',
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
        script: 'belgium',
    },
    US: {
        name: 'United States',
        gl: 'us',
        phoneCode: '1',
        regionLabel: 'state',
        regions: US_CITIES,
        districts: US_DISTRICTS,
        categories: US_CATEGORIES,
        highYield: ['Judaica', 'Judaica store', 'Jewish gift shop', 'Seforim store'],
        acceptLanguage: 'en-US,en;q=0.9',
        contactKeyPage: 'contact',
        contactPaths: ['/contact', '/contact-us', '/pages/contact', '/pages/contact-us', '/about', '/about-us'],
        outputDir: 'output-us',
        // The address names the real town and state ("Brooklyn, NY 11219").
        addressTownWins: true,
        stateInAddress: true,
        // "We export throughout Europe" reads oddly to a shop in Brooklyn.
        emailTemplate: path.join(TEMPLATES, 'partnership-email-us.txt'),
        whatsappTemplate: path.join(TEMPLATES, 'whatsapp-message-us.txt'),
        // Canada (a province and an "A1A 1A1" postcode) and anywhere abroad.
        foreign: /(,\s*(Canada|Israel|Mexico|Bahamas|United Kingdom|UK)|\b(ON|QC|BC|AB|MB|NS|NB)\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d)\s*$/i,
        script: 'us',
    },
    IL: {
        name: 'Israel',
        gl: 'il',
        phoneCode: '972',
        regionLabel: 'district',
        regions: ISRAEL_CITIES,
        districts: ISRAEL_DISTRICTS,
        categories: ISRAEL_CATEGORIES,
        highYield: ['יודאיקה', 'Judaica', 'תשמישי קדושה', 'כלי קודש'],
        acceptLanguage: 'he-IL,he;q=0.9,en;q=0.8',
        // "צור קשר" (contact us), "אודות" (about).
        contactKeyPage: 'contact|%d7%a6%d7%95%d7%a8|צור',
        contactPaths: ['/contact', '/contact-us', '/%D7%A6%D7%95%D7%A8-%D7%A7%D7%A9%D7%A8', '/pages/contact', '/about'],
        outputDir: 'output-il',
        addressTownWins: true,
        // Every shop in Israel is Jewish and kosher: context words say nothing.
        // The targets are Judaica sellers and the gift, souvenir, art and
        // glass shops that sell Judaica to visitors.
        contextEverywhere: true,
        includeTiers: ['Judaica seller', 'Glass & gift shop'],
        // A Hebrew email and WhatsApp message for Israeli shops.
        emailTemplate: path.join(TEMPLATES, 'partnership-email-il.txt'),
        whatsappTemplate: path.join(TEMPLATES, 'whatsapp-message-il.txt'),
        foreign: /,\s*(Jordan|Egypt|Lebanon|Syria|Cyprus|Turkey|Greece)\s*$/i,
        script: 'israel',
    },
};

/** "DE", "UK", "GB", "England", "USA", "Israel" → a COUNTRIES entry (default Germany). */
export function resolveCountry(input = {}) {
    const raw = String(input.country || 'DE').trim().toUpperCase();
    const code = {
        GB: 'UK', ENGLAND: 'UK', 'UNITED KINGDOM': 'UK', GERMANY: 'DE', DEUTSCHLAND: 'DE',
        FRANCE: 'FR', BELGIUM: 'BE', BELGIQUE: 'BE', 'BELGIË': 'BE', BELGIE: 'BE',
        USA: 'US', 'UNITED STATES': 'US', AMERICA: 'US', 'U.S.': 'US', 'U.S.A.': 'US',
        ISRAEL: 'IL', 'ISRAËL': 'IL', ISR: 'IL',
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
