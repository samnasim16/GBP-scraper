/**
 * The world's art markets, for the art campaign: one run, many countries,
 * each searched as itself (as europe.js does for the sushi run). The US and
 * Israel have their own runs; mainland China is left out, because Google
 * Maps barely covers it.
 *
 * A market gives Google's `gl`, the phone code, `trunks` (the national
 * prefixes dropped after the code; "0" when not given), `nationalLengths`
 * (how many digits a national number has once the trunk is gone, when it is
 * written without one; 10 when not given) and `names` (how Maps' English UI
 * names the country at the end of an address abroad).
 */

import { EUROPE_MARKETS } from './europe.js';

const europe = (codes) => Object.fromEntries(codes.map(c => [c, EUROPE_MARKETS[c]]));

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
};

/**
 * Results outside the run's countries: the US (its own run) for a Vancouver
 * or Toronto search, Macau and Shenzhen for Hong Kong, Johor for Singapore,
 * Israel (its own run), and Europe's other countries. Abroad, Maps names the
 * country at the end of the address; UAE addresses separate their parts
 * with " - " instead of commas. "Hong Kong SAR, China" is Hong Kong.
 */
export const WORLD_FOREIGN = /(?:,|\s[-–])\s*(United States|USA|Israel|Palestine|Macau|Macao|Malaysia|Indonesia|Thailand|Philippines|Vietnam|Cambodia|Pakistan|Bangladesh|Sri Lanka|Nepal|Saudi Arabia|Qatar|Oman|Bahrain|Kuwait|Iran|Lebanon|Jordan|Egypt|Morocco|Tunisia|Nigeria|Kenya|Namibia|Botswana|Zimbabwe|Lesotho|Eswatini|Mozambique|Uruguay|Paraguay|Chile|Peru|Bolivia|Ecuador|Venezuela|Panama|Costa Rica|Guatemala|Cuba|Puerto Rico|Dominican Republic|Luxembourg|Liechtenstein|Andorra|San Marino|Poland|Czechia|Czech Republic|Slovakia|Hungary|Slovenia|Croatia|Greece|Cyprus|Malta|Romania|Bulgaria|Serbia|Finland|Estonia|Latvia|Lithuania|Iceland|Ukraine|Russia|Türkiye|Turkey|Georgia|Armenia)\s*$|(?<!Hong Kong(?: SAR)?)\s*,\s*China\s*$|,\s*[A-Z]{2}\s+\d{5}(-\d{4})?\s*$/;
