/**
 * Europe, for the sushi campaign: every country, searched as itself.
 *
 * One run covers many countries, so each search carries its own market —
 * Google's `gl`, the phone trunk code — through `markets[query.state]`
 * (see scrapeQuery in maps.js). `names` are how Maps' English UI spells the
 * country at the end of an address abroad ("…, 77694 Kehl, Germany"), which
 * is what decides the Country column.
 *
 * Cities: every capital and each country's larger cities. Maps shows at most
 * about 120 places per search, so the biggest cities are searched district
 * by district too (EUROPE_SUSHI_DISTRICTS).
 */

// `trunks`: the national prefix dropped after the country code ("0" when
// not given). None in Spain, Portugal, Italy (which keeps its 0), Greece,
// Poland, Czechia, the Nordics but Sweden and Finland, the Baltics but
// Lithuania, Luxembourg and the microstates; "8" in Russia and Belarus.
export const EUROPE_MARKETS = {
    // European Union
    AT: { name: 'Austria', gl: 'at', phoneCode: '43' },
    BE: { name: 'Belgium', gl: 'be', phoneCode: '32', names: ['Belgium', 'Belgique', 'België'] },
    BG: { name: 'Bulgaria', gl: 'bg', phoneCode: '359' },
    HR: { name: 'Croatia', gl: 'hr', phoneCode: '385' },
    CY: { name: 'Cyprus', gl: 'cy', phoneCode: '357', trunks: [] },
    CZ: { name: 'Czechia', gl: 'cz', phoneCode: '420', trunks: [], names: ['Czechia', 'Czech Republic'] },
    DK: { name: 'Denmark', gl: 'dk', phoneCode: '45', trunks: [] },
    EE: { name: 'Estonia', gl: 'ee', phoneCode: '372', trunks: [] },
    FI: { name: 'Finland', gl: 'fi', phoneCode: '358' },
    FR: { name: 'France', gl: 'fr', phoneCode: '33' },
    // Maps names the district after a German postcode ("50823 Ehrenfeld"),
    // so the searched city stays unless the address names another city.
    DE: { name: 'Germany', gl: 'de', phoneCode: '49', names: ['Germany', 'Deutschland'], districtTowns: true },
    GR: { name: 'Greece', gl: 'gr', phoneCode: '30', trunks: [] },
    HU: { name: 'Hungary', gl: 'hu', phoneCode: '36', trunks: ['06'] },
    IE: { name: 'Ireland', gl: 'ie', phoneCode: '353' },
    IT: { name: 'Italy', gl: 'it', phoneCode: '39', trunks: [] },
    LV: { name: 'Latvia', gl: 'lv', phoneCode: '371', trunks: [] },
    LT: { name: 'Lithuania', gl: 'lt', phoneCode: '370', trunks: ['8', '0'] },
    LU: { name: 'Luxembourg', gl: 'lu', phoneCode: '352', trunks: [] },
    MT: { name: 'Malta', gl: 'mt', phoneCode: '356', trunks: [] },
    NL: { name: 'Netherlands', gl: 'nl', phoneCode: '31', names: ['Netherlands', 'The Netherlands'] },
    PL: { name: 'Poland', gl: 'pl', phoneCode: '48', trunks: [] },
    PT: { name: 'Portugal', gl: 'pt', phoneCode: '351', trunks: [] },
    RO: { name: 'Romania', gl: 'ro', phoneCode: '40' },
    SK: { name: 'Slovakia', gl: 'sk', phoneCode: '421' },
    SI: { name: 'Slovenia', gl: 'si', phoneCode: '386' },
    ES: { name: 'Spain', gl: 'es', phoneCode: '34', trunks: [] },
    SE: { name: 'Sweden', gl: 'se', phoneCode: '46' },
    // Rest of Europe. "UK" (not GB) so addresses get the UK post-town reader.
    UK: { name: 'United Kingdom', gl: 'gb', phoneCode: '44', names: ['United Kingdom', 'UK'] },
    NO: { name: 'Norway', gl: 'no', phoneCode: '47', trunks: [] },
    CH: { name: 'Switzerland', gl: 'ch', phoneCode: '41' },
    IS: { name: 'Iceland', gl: 'is', phoneCode: '354', trunks: [] },
    LI: { name: 'Liechtenstein', gl: 'li', phoneCode: '423', trunks: [] },
    MC: { name: 'Monaco', gl: 'mc', phoneCode: '377', trunks: [] },
    AD: { name: 'Andorra', gl: 'ad', phoneCode: '376', trunks: [] },
    SM: { name: 'San Marino', gl: 'sm', phoneCode: '378', trunks: [] },
    RS: { name: 'Serbia', gl: 'rs', phoneCode: '381' },
    BA: { name: 'Bosnia and Herzegovina', gl: 'ba', phoneCode: '387' },
    ME: { name: 'Montenegro', gl: 'me', phoneCode: '382' },
    MK: { name: 'North Macedonia', gl: 'mk', phoneCode: '389' },
    AL: { name: 'Albania', gl: 'al', phoneCode: '355' },
    XK: { name: 'Kosovo', gl: 'xk', phoneCode: '383' },
    MD: { name: 'Moldova', gl: 'md', phoneCode: '373' },
    UA: { name: 'Ukraine', gl: 'ua', phoneCode: '380' },
    BY: { name: 'Belarus', gl: 'by', phoneCode: '375', trunks: ['8'] },
    // European cities only.
    RU: { name: 'Russia', gl: 'ru', phoneCode: '7', trunks: ['8'] },
    TR: { name: 'Türkiye', gl: 'tr', phoneCode: '90', names: ['Türkiye', 'Turkey'] },
};

export const EUROPE_SUSHI_CITIES = {
    AT: ['Vienna', 'Graz', 'Linz', 'Salzburg', 'Innsbruck', 'Klagenfurt'],
    BE: ['Brussels', 'Antwerp', 'Ghent', 'Bruges', 'Liège', 'Leuven', 'Namur', 'Charleroi'],
    BG: ['Sofia', 'Plovdiv', 'Varna', 'Burgas'],
    HR: ['Zagreb', 'Split', 'Rijeka', 'Dubrovnik', 'Zadar', 'Osijek'],
    CY: ['Nicosia', 'Limassol', 'Larnaca', 'Paphos'],
    CZ: ['Prague', 'Brno', 'Ostrava', 'Plzeň', 'Olomouc'],
    DK: ['Copenhagen', 'Aarhus', 'Odense', 'Aalborg'],
    EE: ['Tallinn', 'Tartu'],
    FI: ['Helsinki', 'Espoo', 'Tampere', 'Turku', 'Oulu'],
    FR: ['Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg', 'Montpellier', 'Bordeaux', 'Lille',
        'Rennes', 'Reims', 'Toulon', 'Grenoble', 'Dijon', 'Angers', 'Nîmes', 'Aix-en-Provence', 'Clermont-Ferrand',
        'Le Havre', 'Tours', 'Limoges', 'Metz', 'Nancy', 'Rouen', 'Cannes', 'Perpignan', 'Caen', 'Orléans', 'Avignon'],
    DE: ['Berlin', 'Hamburg', 'Munich', 'Cologne', 'Frankfurt', 'Stuttgart', 'Düsseldorf', 'Leipzig', 'Dortmund', 'Essen',
        'Bremen', 'Dresden', 'Hanover', 'Nuremberg', 'Duisburg', 'Bochum', 'Wuppertal', 'Bielefeld', 'Bonn', 'Münster',
        'Mannheim', 'Karlsruhe', 'Augsburg', 'Wiesbaden', 'Mainz', 'Freiburg', 'Heidelberg', 'Kiel', 'Aachen', 'Regensburg'],
    GR: ['Athens', 'Thessaloniki', 'Patras', 'Heraklion', 'Piraeus', 'Larissa', 'Rhodes', 'Mykonos', 'Santorini'],
    HU: ['Budapest', 'Debrecen', 'Szeged', 'Pécs', 'Győr'],
    IE: ['Dublin', 'Cork', 'Galway', 'Limerick', 'Waterford'],
    IT: ['Rome', 'Milan', 'Naples', 'Turin', 'Palermo', 'Genoa', 'Bologna', 'Florence', 'Bari', 'Catania', 'Venice',
        'Verona', 'Padua', 'Trieste', 'Brescia', 'Parma', 'Modena', 'Bergamo', 'Pisa', 'Rimini', 'Cagliari', 'Monza'],
    LV: ['Riga', 'Daugavpils', 'Jūrmala'],
    LT: ['Vilnius', 'Kaunas', 'Klaipėda'],
    LU: ['Luxembourg', 'Esch-sur-Alzette'],
    MT: ['Valletta', 'Sliema', "St. Julian's"],
    NL: ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven', 'Groningen', 'Tilburg', 'Almere', 'Breda',
        'Nijmegen', 'Haarlem', 'Arnhem', 'Maastricht', 'Leiden'],
    PL: ['Warsaw', 'Kraków', 'Łódź', 'Wrocław', 'Poznań', 'Gdańsk', 'Szczecin', 'Bydgoszcz', 'Lublin', 'Katowice',
        'Białystok', 'Gdynia', 'Rzeszów', 'Toruń'],
    PT: ['Lisbon', 'Porto', 'Braga', 'Coimbra', 'Faro', 'Funchal', 'Aveiro', 'Cascais'],
    RO: ['Bucharest', 'Cluj-Napoca', 'Timișoara', 'Iași', 'Constanța', 'Brașov', 'Sibiu', 'Oradea'],
    SK: ['Bratislava', 'Košice', 'Žilina'],
    SI: ['Ljubljana', 'Maribor'],
    ES: ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Zaragoza', 'Málaga', 'Murcia', 'Palma', 'Las Palmas de Gran Canaria',
        'Bilbao', 'Alicante', 'Córdoba', 'Valladolid', 'Vigo', 'Gijón', 'A Coruña', 'Granada', 'San Sebastián', 'Santander',
        'Marbella', 'Santa Cruz de Tenerife', 'Pamplona', 'Ibiza'],
    SE: ['Stockholm', 'Gothenburg', 'Malmö', 'Uppsala', 'Västerås', 'Örebro', 'Linköping'],
    UK: ['London', 'Birmingham', 'Manchester', 'Glasgow', 'Edinburgh', 'Liverpool', 'Leeds', 'Bristol', 'Sheffield',
        'Newcastle upon Tyne', 'Nottingham', 'Leicester', 'Cardiff', 'Belfast', 'Brighton', 'Southampton', 'Oxford',
        'Cambridge', 'Reading', 'Aberdeen', 'Bath', 'York', 'Coventry', 'Milton Keynes'],
    NO: ['Oslo', 'Bergen', 'Trondheim', 'Stavanger', 'Tromsø'],
    CH: ['Zurich', 'Geneva', 'Basel', 'Bern', 'Lausanne', 'Lucerne', 'Lugano', 'St. Gallen'],
    IS: ['Reykjavík'],
    LI: ['Vaduz'],
    MC: ['Monaco'],
    AD: ['Andorra la Vella'],
    SM: ['San Marino'],
    RS: ['Belgrade', 'Novi Sad', 'Niš'],
    BA: ['Sarajevo', 'Banja Luka', 'Mostar'],
    ME: ['Podgorica', 'Budva', 'Kotor'],
    MK: ['Skopje', 'Ohrid'],
    AL: ['Tirana', 'Durrës', 'Vlorë'],
    XK: ['Pristina', 'Prizren'],
    MD: ['Chișinău'],
    UA: ['Kyiv', 'Lviv', 'Odesa', 'Kharkiv', 'Dnipro'],
    BY: ['Minsk', 'Brest', 'Grodno'],
    RU: ['Moscow', 'Saint Petersburg', 'Kazan', 'Nizhny Novgorod', 'Kaliningrad', 'Sochi'],
    TR: ['Istanbul'],
};

export const EUROPE_SUSHI_DISTRICTS = {
    London: ['Soho', 'Covent Garden', 'Shoreditch', 'Camden', 'Kensington', 'Canary Wharf', 'Islington', 'Hammersmith',
        'Brixton', 'Stratford', 'Mayfair', 'Clapham'],
    Paris: ['Le Marais', 'Saint-Germain-des-Prés', 'Montmartre', 'Bastille', 'Opéra', 'Montparnasse', 'Batignolles',
        'Belleville', '15th arrondissement', '16th arrondissement', '13th arrondissement', 'La Défense'],
    Berlin: ['Mitte', 'Kreuzberg', 'Prenzlauer Berg', 'Charlottenburg', 'Friedrichshain', 'Schöneberg', 'Neukölln', 'Steglitz'],
    Hamburg: ['Altona', 'St. Pauli', 'Eimsbüttel', 'Altstadt', 'Winterhude'],
    Munich: ['Altstadt', 'Schwabing', 'Maxvorstadt', 'Haidhausen', 'Sendling'],
    Madrid: ['Centro', 'Salamanca', 'Chamberí', 'Malasaña', 'Retiro', 'Chamartín', 'Tetuán'],
    Barcelona: ['Eixample', 'Gràcia', 'Ciutat Vella', 'Sants', 'Les Corts', 'Sant Martí', 'Sarrià-Sant Gervasi'],
    Rome: ['Centro Storico', 'Trastevere', 'Prati', 'Parioli', 'EUR', 'San Giovanni', 'Monteverde'],
    Milan: ['Brera', 'Navigli', 'Porta Romana', 'Isola', 'Città Studi', 'Porta Nuova', 'Centro Storico', 'Sempione'],
    Amsterdam: ['Centrum', 'De Pijp', 'Zuid', 'Oost', 'West'],
    Vienna: ['Innere Stadt', 'Leopoldstadt', 'Neubau', 'Wieden', 'Landstraße'],
    Warsaw: ['Śródmieście', 'Mokotów', 'Wola', 'Praga'],
    Lisbon: ['Baixa', 'Avenidas Novas', 'Parque das Nações', 'Belém'],
    Athens: ['Kolonaki', 'Glyfada', 'Kifisia', 'Syntagma'],
    Brussels: ['Ixelles', 'Saint-Gilles', 'Uccle', 'Etterbeek'],
    Stockholm: ['Södermalm', 'Östermalm', 'Vasastan', 'Kungsholmen'],
    Budapest: ['District V', 'District VI', 'District XIII'],
    Bucharest: ['Sector 1', 'Sector 2', 'Sector 3'],
    Prague: ['Prague 1', 'Prague 2', 'Prague 5'],
    Dublin: ['City Centre', 'Ranelagh', 'Rathmines'],
    Kyiv: ['Pecherskyi', 'Shevchenkivskyi', 'Podil'],
    Moscow: ['Arbat', 'Tverskoy', 'Zamoskvorechye', 'Presnensky', 'Khamovniki'],
    'Saint Petersburg': ['Tsentralny', 'Petrogradsky', 'Vasileostrovsky'],
    Istanbul: ['Beşiktaş', 'Kadıköy', 'Şişli', 'Beyoğlu', 'Ataşehir'],
};

/**
 * Every name an address may end with, for the Country column: "Germany" → DE.
 * UAE addresses separate their parts with " - " ("Al Quoz - Dubai - United
 * Arab Emirates").
 */
export function marketOfAddress(address, markets = EUROPE_MARKETS) {
    const last = String(address || '').split(/,|\s[-–]\s/).map(p => p.trim()).filter(Boolean).pop() || '';
    for (const [code, m] of Object.entries(markets)) {
        if ((m.names || [m.name]).some(n => n.toLowerCase() === last.toLowerCase())) return code;
    }
    return '';
}
