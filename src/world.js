/**
 * The world's art markets, for the art campaign: one run, many countries,
 * each searched as itself (as europe.js does for the sushi run). The US and
 * Israel have their own runs; mainland China is left out, because Google
 * Maps barely covers it; Russia and Belarus are left out because sanctions
 * make selling art there impractical (payments, shipping and export
 * licences), so a buyer there is no use to a seller.
 *
 * A market gives Google's `gl`, the phone code, `trunks` (the national
 * prefixes dropped after the code; "0" when not given), `nationalLengths`
 * (how many digits a national number has once the trunk is gone, when it is
 * written without one; 10 when not given) and `names` (how Maps' English UI
 * names the country at the end of an address abroad).
 */

import { EUROPE_MARKETS } from './europe.js';

const europe = (codes) => Object.fromEntries(codes.map(c => [c, EUROPE_MARKETS[c]]));

/**
 * The rest of Europe, from the sushi run's entries, with how many digits a
 * national number has once its trunk 0 is gone ("1 234 5678" in Budapest is
 * +36 1 234 5678, not +1…). The trunk-free markets (Cyprus, Czechia,
 * Estonia, Greece, Latvia, Luxembourg, Malta, Poland, Iceland,
 * Liechtenstein, Andorra, San Marino) add the code to every national number
 * already; Finland's lengths vary too much to guess; Türkiye's 10 is the
 * default. Prague's and Bratislava's addresses name the district ("110 00
 * Staré Město", "811 01 Bratislava-Staré Mesto"), so the searched city stays
 * there unless the address names another searched city.
 */
const MORE_EUROPE = {
    BG: { nationalLengths: [8, 9] }, HR: { nationalLengths: [8, 9] }, CY: {}, CZ: { districtTowns: true }, EE: {}, FI: {}, GR: {},
    HU: { nationalLengths: [8, 9] }, LV: {}, LT: { nationalLengths: [8] }, LU: {}, MT: {}, PL: {}, RO: { nationalLengths: [9] },
    SK: { nationalLengths: [9], districtTowns: true }, SI: { nationalLengths: [8] }, IS: {}, LI: {}, AD: {}, SM: {},
    RS: { nationalLengths: [8, 9] }, BA: { nationalLengths: [8, 9] }, ME: { nationalLengths: [8] }, MK: { nationalLengths: [8] },
    AL: { nationalLengths: [8, 9] }, XK: { nationalLengths: [8] }, MD: { nationalLengths: [8] }, UA: { nationalLengths: [9] }, TR: {},
};

export const WORLD_MARKETS = {
    // Europe: the sushi run's entries ("UK", not GB, so addresses get the UK post-town reader).
    ...europe(['UK', 'FR', 'DE', 'CH', 'IT', 'ES', 'NL', 'BE', 'AT', 'SE', 'DK', 'NO', 'IE', 'PT', 'MC']),
    // Asia. Hong Kong and Singapore have no trunk prefix (8-digit numbers);
    // Japan, Korea, Taiwan, India and the UAE drop a 0.
    HK: { name: 'Hong Kong', gl: 'hk', phoneCode: '852', trunks: [], names: ['Hong Kong', 'Hong Kong SAR'] },
    SG: { name: 'Singapore', gl: 'sg', phoneCode: '65', trunks: [] },
    // 03-1234-5678 (9 digits after the 0), 090-1234-5678 (10).
    JP: { name: 'Japan', gl: 'jp', phoneCode: '81', nationalLengths: [9, 10] },
    // 02-123-4567 / 02-1234-5678 (8–9), 010-1234-5678 (10).
    KR: { name: 'South Korea', gl: 'kr', phoneCode: '82', nationalLengths: [8, 9, 10], names: ['South Korea', 'Korea', 'Republic of Korea'] },
    // 02-2345-6789, 0912-345-678 (9 after the 0; 8 outside Taipei).
    TW: { name: 'Taiwan', gl: 'tw', phoneCode: '886', nationalLengths: [8, 9] },
    // Mobiles are written without the 0 (98200 12345): ten digits get +91.
    IN: { name: 'India', gl: 'in', phoneCode: '91' },
    // 04 123 4567 (8 after the 0), 050 123 4567 (9).
    AE: { name: 'United Arab Emirates', gl: 'ae', phoneCode: '971', nationalLengths: [8, 9], names: ['United Arab Emirates', 'UAE'] },
    // Oceania. Australian addresses name the suburb ("Paddington NSW 2021"),
    // so the searched city stays unless the suburb is itself a searched city.
    AU: { name: 'Australia', gl: 'au', phoneCode: '61', nationalLengths: [9, 10], districtTowns: true },
    NZ: { name: 'New Zealand', gl: 'nz', phoneCode: '64', nationalLengths: [8, 9] },
    // The Americas. Canada is +1 like the US: no trunk, a ten-digit number
    // gets the 1 and an eleven-digit one already has it. Mexico dropped its
    // 01 / 044 / 045 prefixes in 2019 (all numbers are ten digits now), but
    // old listings still carry them. Brazil: a 0 (and on long distance a
    // carrier code, which is not handled) before a 2-digit area code, then
    // 8 or 9 digits. Argentina drops a 0 (011 4123-4567); a mobile's "15" is
    // kept as written. Colombia has no trunk prefix since 2021 (601…, 3…).
    CA: { name: 'Canada', gl: 'ca', phoneCode: '1' },
    MX: { name: 'Mexico', gl: 'mx', phoneCode: '52', trunks: ['01', '044', '045'], names: ['Mexico', 'México'] },
    BR: { name: 'Brazil', gl: 'br', phoneCode: '55', nationalLengths: [10, 11], names: ['Brazil', 'Brasil'] },
    AR: { name: 'Argentina', gl: 'ar', phoneCode: '54' },
    CO: { name: 'Colombia', gl: 'co', phoneCode: '57', trunks: [] },
    // Africa: 021 123 4567 (9 after the 0).
    ZA: { name: 'South Africa', gl: 'za', phoneCode: '27', nationalLengths: [9] },

    // The rest of Europe but Russia and Belarus (see the top of this file).
    ...Object.fromEntries(Object.entries(MORE_EUROPE).map(([c, extra]) => [c, { ...EUROPE_MARKETS[c], ...extra }])),

    // The Gulf and the Levant. Qatar and Kuwait have no trunk prefix (8-digit
    // numbers). Saudi Arabia drops a 0: 011 234 5678 and 05x xxx xxxx are 9
    // digits after it. Lebanon drops a 0 before its landlines and the old
    // 03 mobiles (01 234 567: 7 digits after it); the newer mobiles are
    // written without one (70 123 456: 8).
    QA: { name: 'Qatar', gl: 'qa', phoneCode: '974', trunks: [] },
    SA: { name: 'Saudi Arabia', gl: 'sa', phoneCode: '966', nationalLengths: [9] },
    KW: { name: 'Kuwait', gl: 'kw', phoneCode: '965', trunks: [] },
    LB: { name: 'Lebanon', gl: 'lb', phoneCode: '961', nationalLengths: [7, 8] },
    // South America. Chile's numbers are 9 digits (2 2345 6789, 9 8765 4321);
    // old listings still write a 0 before them. Peru: (01) 234 5678 in Lima
    // is 8 digits after the 0, a mobile 9 (987 654 321) and written without
    // one. Uruguay: 8 digits (2915 1234), a mobile 099 123 456. Punta del Este
    // and José Ignacio are where Uruguay's collectors buy in summer. Lima's
    // and Santiago's addresses name the district or commune (Miraflores,
    // Barranco, Vitacura, Las Condes), so the searched city stays there.
    CL: { name: 'Chile', gl: 'cl', phoneCode: '56', nationalLengths: [9], districtTowns: true },
    PE: { name: 'Peru', gl: 'pe', phoneCode: '51', nationalLengths: [8, 9], districtTowns: true },
    UY: { name: 'Uruguay', gl: 'uy', phoneCode: '598', nationalLengths: [8] },
    // Southeast Asia, every one with a trunk 0. Thailand: 02 123 4567 (8 after
    // it), 081 234 5678 (9). Indonesia: (021) 1234 5678 (10), 0812 3456 7890
    // (11), Bali's (0361) 123 456 (9). The Philippines: (02) 8123 4567 (9),
    // 0917 123 4567 (10). Malaysia: 03-1234 5678 (9), 012-345 6789 (9),
    // 011-1234 5678 (10), 04-123 4567 in Penang (8). Vietnam: 028 1234 5678
    // (10), 090 123 4567 (9).
    TH: { name: 'Thailand', gl: 'th', phoneCode: '66', nationalLengths: [8, 9] },
    ID: { name: 'Indonesia', gl: 'id', phoneCode: '62', nationalLengths: [9, 10, 11] },
    PH: { name: 'Philippines', gl: 'ph', phoneCode: '63', nationalLengths: [9, 10] },
    MY: { name: 'Malaysia', gl: 'my', phoneCode: '60', nationalLengths: [8, 9, 10] },
    VN: { name: 'Vietnam', gl: 'vn', phoneCode: '84', nationalLengths: [9, 10], names: ['Vietnam', 'Viet Nam'] },
    // Africa, every one with a trunk 0. Nigeria: 01 234 5678 in Lagos (8 after
    // it), 0803 123 4567 (10). Kenya: 020 123 4567 and 0712 345 678 (9).
    // Egypt: 02 2345 6789 in Cairo (9), 010 1234 5678 (10). Morocco and Ghana:
    // 9 digits after the 0 (0522 12 34 56, 0612 34 56 78; 030 123 4567).
    NG: { name: 'Nigeria', gl: 'ng', phoneCode: '234', nationalLengths: [8, 10] },
    KE: { name: 'Kenya', gl: 'ke', phoneCode: '254', nationalLengths: [9] },
    EG: { name: 'Egypt', gl: 'eg', phoneCode: '20', nationalLengths: [9, 10] },
    MA: { name: 'Morocco', gl: 'ma', phoneCode: '212', nationalLengths: [9] },
    GH: { name: 'Ghana', gl: 'gh', phoneCode: '233', nationalLengths: [9] },
};

/**
 * Each country's art cities: the capitals of the trade, the art-fair and
 * auction cities (Basel, Maastricht, Venice, Hong Kong, Dubai…) and the
 * resort towns where collectors buy (St. Moritz, Saint-Paul-de-Vence,
 * Knokke, Monaco).
 */
export const WORLD_ART_CITIES = {
    UK: ['London', 'Edinburgh', 'Glasgow', 'Manchester', 'Bath', 'Bristol'],
    FR: ['Paris', 'Lyon', 'Marseille', 'Nice', 'Saint-Paul-de-Vence', 'Bordeaux'],
    DE: ['Berlin', 'Munich', 'Cologne', 'Düsseldorf', 'Hamburg', 'Frankfurt', 'Leipzig'],
    CH: ['Zurich', 'Geneva', 'Basel', 'St. Moritz', 'Lugano'],
    IT: ['Milan', 'Rome', 'Venice', 'Florence', 'Turin', 'Naples'],
    ES: ['Madrid', 'Barcelona', 'Valencia', 'Málaga'],
    NL: ['Amsterdam', 'Rotterdam', 'The Hague', 'Maastricht'],
    BE: ['Brussels', 'Antwerp', 'Knokke-Heist'],
    AT: ['Vienna', 'Salzburg'],
    SE: ['Stockholm', 'Gothenburg'],
    DK: ['Copenhagen'],
    NO: ['Oslo'],
    IE: ['Dublin'],
    PT: ['Lisbon', 'Porto'],
    MC: ['Monaco'],
    HK: ['Hong Kong'],
    SG: ['Singapore'],
    JP: ['Tokyo', 'Kyoto', 'Osaka'],
    KR: ['Seoul', 'Busan'],
    TW: ['Taipei', 'Kaohsiung'],
    IN: ['Mumbai', 'New Delhi', 'Kolkata', 'Bengaluru'],
    AE: ['Dubai', 'Abu Dhabi'],
    AU: ['Sydney', 'Melbourne', 'Brisbane', 'Perth'],
    NZ: ['Auckland', 'Wellington'],
    CA: ['Toronto', 'Vancouver', 'Montreal', 'Calgary'],
    MX: ['Mexico City', 'Guadalajara', 'Monterrey', 'Oaxaca'],
    BR: ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte'],
    AR: ['Buenos Aires'],
    CO: ['Bogotá', 'Medellín'],
    ZA: ['Cape Town', 'Johannesburg', 'Durban'],
    // The rest of Europe: each capital and the cities with an art trade of
    // their own (from the sushi run's list), plus Szentendre, Hungary's
    // artists' town (as Saint-Paul-de-Vence is France's).
    BG: ['Sofia', 'Plovdiv'],
    HR: ['Zagreb', 'Split', 'Dubrovnik'],
    CY: ['Nicosia', 'Limassol'],
    CZ: ['Prague', 'Brno'],
    EE: ['Tallinn', 'Tartu'],
    FI: ['Helsinki', 'Turku'],
    GR: ['Athens', 'Thessaloniki', 'Mykonos'],
    HU: ['Budapest', 'Szentendre', 'Debrecen', 'Szeged', 'Pécs'],
    LV: ['Riga'],
    LT: ['Vilnius', 'Kaunas'],
    LU: ['Luxembourg'],
    MT: ['Valletta'],
    PL: ['Warsaw', 'Kraków', 'Wrocław', 'Poznań', 'Gdańsk', 'Łódź'],
    RO: ['Bucharest', 'Cluj-Napoca', 'Timișoara'],
    SK: ['Bratislava', 'Košice'],
    SI: ['Ljubljana'],
    IS: ['Reykjavík'],
    LI: ['Vaduz'],
    AD: ['Andorra la Vella'],
    SM: ['San Marino'],
    RS: ['Belgrade', 'Novi Sad'],
    BA: ['Sarajevo'],
    ME: ['Podgorica'],
    MK: ['Skopje'],
    AL: ['Tirana'],
    XK: ['Pristina'],
    MD: ['Chișinău'],
    UA: ['Kyiv', 'Lviv', 'Odesa'],
    // Istanbul, and Türkiye's other art cities beyond Europe.
    TR: ['Istanbul', 'Ankara', 'Izmir'],
    // The Gulf, the Levant, South America, Southeast Asia and Africa.
    QA: ['Doha'],
    SA: ['Riyadh', 'Jeddah'],
    KW: ['Kuwait City'],
    LB: ['Beirut'],
    CL: ['Santiago', 'Valparaíso'],
    PE: ['Lima', 'Cusco'],
    UY: ['Montevideo', 'Punta del Este', 'José Ignacio'],
    TH: ['Bangkok', 'Chiang Mai'],
    ID: ['Jakarta', 'Yogyakarta', 'Bandung', 'Ubud', 'Denpasar'],
    PH: ['Manila', 'Makati', 'Quezon City'],
    MY: ['Kuala Lumpur', 'Penang'],
    VN: ['Ho Chi Minh City', 'Hanoi'],
    NG: ['Lagos', 'Abuja'],
    KE: ['Nairobi'],
    EG: ['Cairo', 'Alexandria'],
    MA: ['Marrakesh', 'Casablanca', 'Rabat', 'Tangier'],
    GH: ['Accra'],
};

/**
 * Gallery districts. Maps shows at most ~120 places per search, and London,
 * Paris, Berlin, Hong Kong or Tokyo alone have more galleries than that, so
 * their gallery neighbourhoods are searched one by one.
 */
export const WORLD_ART_DISTRICTS = {
    London: ['Mayfair', "St James's", 'Shoreditch', 'Fitzrovia', 'Chelsea', 'Kensington', 'Bermondsey', 'Notting Hill'],
    Paris: ['Le Marais', 'Saint-Germain-des-Prés', '8th arrondissement', 'Avenue Matignon', 'Drouot', 'Belleville', 'Montmartre'],
    Berlin: ['Mitte', 'Kreuzberg', 'Charlottenburg', 'Schöneberg', 'Tiergarten'],
    Munich: ['Maxvorstadt', 'Altstadt-Lehel', 'Schwabing'],
    Zurich: ['Kreis 5', 'Altstadt'],
    Geneva: ['Quartier des Bains', 'Vieille Ville'],
    Milan: ['Brera', 'Porta Venezia', 'Lambrate', 'Isola'],
    Rome: ['Centro Storico', 'Via Margutta', 'Trastevere'],
    Madrid: ['Salamanca', 'Chueca', 'Lavapiés'],
    Barcelona: ['Eixample', 'El Born', 'Gràcia'],
    Amsterdam: ['Jordaan', 'Spiegelkwartier', 'Centrum'],
    Brussels: ['Ixelles', 'Sablon', 'Saint-Gilles'],
    Vienna: ['Innere Stadt', 'Leopoldstadt', 'Mariahilf'],
    Lisbon: ['Chiado', 'Marvila', 'Príncipe Real'],
    Copenhagen: ['Indre By', 'Vesterbro'],
    Stockholm: ['Östermalm', 'Södermalm'],
    'Hong Kong': ['Central', 'Sheung Wan', 'Wong Chuk Hang', 'Tsim Sha Tsui'],
    Singapore: ['Gillman Barracks', 'Tanjong Pagar'],
    Tokyo: ['Ginza', 'Kyobashi', 'Roppongi', 'Shibuya', 'Kiyosumi-Shirakawa'],
    Seoul: ['Samcheong-dong', 'Hannam-dong', 'Insadong', 'Cheongdam-dong'],
    Taipei: ["Da'an", 'Neihu'],
    Mumbai: ['Colaba', 'Kala Ghoda'],
    'New Delhi': ['Hauz Khas', 'Lado Sarai', 'Defence Colony'],
    Dubai: ['Alserkal Avenue', 'DIFC'],
    Sydney: ['Paddington', 'Redfern', 'Woollahra'],
    Melbourne: ['Fitzroy', 'Collingwood', 'South Yarra'],
    Toronto: ['Queen West', 'Yorkville'],
    Montreal: ['Old Montreal', 'Mile End'],
    'Mexico City': ['Roma Norte', 'Polanco', 'San Miguel Chapultepec', 'Juárez'],
    'São Paulo': ['Jardins', 'Pinheiros', 'Vila Madalena', 'Barra Funda'],
    'Buenos Aires': ['Palermo', 'Recoleta', 'San Telmo', 'Villa Crespo'],
    Bogotá: ['San Felipe', 'Chapinero'],
    'Cape Town': ['Woodstock', 'City Bowl'],
    Johannesburg: ['Rosebank', 'Parkwood', 'Maboneng'],
    // Budapest's galleries cluster in district V around Falk Miksa utca (by
    // Parliament) and in districts VI and VII.
    Budapest: ['District V', 'Falk Miksa utca', 'District VI', 'District VII'],
    Istanbul: ['Beyoğlu', 'Karaköy', 'Nişantaşı', 'Kadıköy'],
    Prague: ['Prague 1', 'Prague 7'],
    Warsaw: ['Śródmieście', 'Praga', 'Wola'],
    Kraków: ['Stare Miasto', 'Kazimierz'],
    Athens: ['Kolonaki', 'Psyrri', 'Metaxourgeio'],
    Kyiv: ['Podil', 'Pecherskyi', 'Shevchenkivskyi'],
    Beirut: ['Mar Mikhael', 'Gemmayzeh', 'Achrafieh'],
    Santiago: ['Vitacura', 'Providencia', 'Lastarria'],
    Lima: ['Miraflores', 'Barranco', 'San Isidro'],
    Bangkok: ['Bang Rak', 'Sathorn', 'Sukhumvit', 'Pathum Wan'],
    Jakarta: ['Kemang', 'Menteng', 'Kebayoran Baru'],
    'Ho Chi Minh City': ['District 1', 'Thao Dien'],
    Hanoi: ['Hoan Kiem'],
    Lagos: ['Victoria Island', 'Ikoyi', 'Lekki'],
    Cairo: ['Zamalek', 'Downtown', 'Garden City'],
};

/**
 * Results outside the run's countries: the US (its own run) for a Vancouver
 * or Toronto search, Macau and Shenzhen for Hong Kong, Israel (its own run),
 * Russia and Belarus (sanctions; see the top of this file), and the
 * neighbours of the run's countries (Brunei for Malaysia, Laos, Cambodia and
 * Myanmar for Thailand and Vietnam, Jordan and Syria for Lebanon, Algeria
 * for Morocco, Togo and Côte d'Ivoire for Ghana…). Abroad, Maps names the
 * country at the end of the address; UAE addresses separate their parts
 * with " - " instead of commas. "Hong Kong SAR, China" is Hong Kong.
 */
export const WORLD_FOREIGN = /(?:,|\s[-–])\s*(United States|USA|Israel|Palestine|Palestinian Territories|Macau|Macao|Cambodia|Laos|Myanmar|Myanmar \(Burma\)|Brunei|Timor-Leste|Papua New Guinea|Pakistan|Bangladesh|Sri Lanka|Nepal|Oman|Bahrain|Iran|Iraq|Syria|Jordan|Yemen|Tunisia|Algeria|Libya|Sudan|South Sudan|Ethiopia|Somalia|Uganda|Tanzania|Rwanda|Togo|Benin|Burkina Faso|Côte d'Ivoire|Cote d'Ivoire|Niger|Cameroon|Chad|Namibia|Botswana|Zimbabwe|Lesotho|Eswatini|Mozambique|Paraguay|Bolivia|Ecuador|Venezuela|Panama|Costa Rica|Guatemala|Cuba|Puerto Rico|Dominican Republic|Russia|Belarus|Georgia|Armenia|Azerbaijan|Kazakhstan)\s*$|(?<!Hong Kong(?: SAR)?)\s*,\s*China\s*$|,\s*[A-Z]{2}\s+\d{5}(-\d{4})?\s*$/;
