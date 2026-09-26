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
export function resolveLocations({ states = [], cities = [], districts = true } = {}, log = console.log) {
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
            : Object.keys(GERMAN_CITIES);
        for (const code of wanted) {
            const list = GERMAN_CITIES[code];
            if (!list) { log(`⚠️  Unknown Bundesland "${code}" — skipping. Known: ${Object.keys(GERMAN_CITIES).join(', ')}`); continue; }
            for (const city of list) push(code, city);
        }
    }

    if (districts) {
        for (const loc of [...out]) {
            for (const d of CITY_DISTRICTS[loc.city] || []) push(loc.state, `${d}, ${loc.city}`);
        }
    }
    return out;
}

/** Build the query matrix, high-yield terms first across every location. */
export function buildQueryMatrix(locations, categories) {
    const rank = (cat) => {
        const i = HIGH_YIELD.indexOf(cat);
        return i === -1 ? HIGH_YIELD.length : i;
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
