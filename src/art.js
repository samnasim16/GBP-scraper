/**
 * The art campaign, for Varnish AI: which places buy artwork, sell it on
 * consignment, represent its artists, or advise the collectors who do?
 * Varnish AI helps people sell artwork and recommends these buyers to them,
 * so the campaign builds a directory of galleries, auction houses, art
 * dealers and art advisors from Google Business Profiles in the US, Israel
 * and the world's other art markets (world.js). Names and sites are read in
 * their own language: the same lists carry Hebrew words (matched after the
 * prefix letters ו ה ב כ ל ש, as in relevance.js), the main European
 * languages, and Japanese, Korean and Chinese (matched anywhere). Every
 * field keeps its English values (`specialties` are English words whatever
 * the site's language).
 *
 * Same idea as the Judaica scoring in relevance.js and sushi.js: every row is
 * scored on the words in its name, Maps category and description, and (once
 * read) its own website, and banded into a tier. "Art gallery Santa Fe" also
 * returns frame shops, art-supply stores, paint-and-sip studios, tattoo
 * parlours and museums, so the tier, not the search term, decides who is in
 * the directory.
 *
 * Every art lead also carries the fields the Varnish importer reads from
 * leads.json (the contract; see CLAUDE.md): art_type, accepts_submissions,
 * submission_url, accepts_consignments, consign_url and specialties.
 */

import { clean } from './util.js';

/** Tiers, best first. The first four are the buyers (see CAMPAIGNS in config.js). */
export const ART_TIERS = ['Gallery', 'Auction house', 'Art dealer', 'Art advisor', 'Not a buyer', 'Non-profit / museum'];

/** `art_type` in leads.json for each buyer tier; empty for the other two. */
const ART_TYPE = { Gallery: 'gallery', 'Auction house': 'auction_house', 'Art dealer': 'dealer', 'Art advisor': 'art_advisor' };
const TIER_OF = Object.fromEntries(Object.entries(ART_TYPE).map(([tier, type]) => [type, tier]));

/**
 * Words matched at a word START, as in relevance.js: "Framing" is a frame
 * word, "Timeframe" is not. `WHOLE` also ends the word: "Salon 94" is a
 * gallery, not a hair salon, and "Barbara" is not a bar.
 */
const WHOLE = '(?![\\p{L}\\p{N}])';
/**
 * `he`: Hebrew words, after up to two prefix letters (ו ה ב כ ל ש:
 * "הגלריה", "בגלריה", "לאמנות") and with no end, so plurals and construct
 * forms match ("גלריית", "תערוכות"); a word that needs an end says so. Not
 * מ, as in relevance.js. `cjk`: Japanese, Chinese and Korean words, which
 * match anywhere, because those scripts put no space between words
 * ("銀座ギャラリー", "국제갤러리").
 */
const words = (alternatives, end = WHOLE, { he = [], cjk = [] } = {}) => new RegExp([
    alternatives.length ? `(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})${end}` : '',
    he.length ? `(?<![\\p{L}\\p{N}])[והבכלש]{0,2}(?:${he.join('|')})` : '',
    cjk.length ? `(?:${cjk.join('|')})` : '',
].filter(Boolean).join('|'), 'giu');
const has = (re, text) => String(text || '').search(re) !== -1;
/** A Hebrew word that must end there: "סוחר" (dealer), not "סוחרים". */
const HE_END = '(?![\\p{L}])';
/** בע"מ (Ltd): a company, whatever else its Hebrew name says. */
const HE_COMPANY = /בע["״]?מ/;

/** The distinct words found (lower case), and how often any of them occurs. */
function find(re, text) {
    const found = new Set();
    let count = 0;
    for (const m of String(text || '').matchAll(re)) {
        found.add(clean(m[0]).toLowerCase().slice(0, 40));
        count++;
    }
    return { words: [...found], count };
}

// ─── Museums and non-profits ──────────────────────────────────────────────

/**
 * "Museum" that names a place, not an institution: a commercial gallery in
 * Houston's Museum District, on Santa Fe's Museum Hill or in Miami's Museum
 * Park; and a frame shop's "museum-quality framing".
 */
const MUSEUM_PLACE = /(?<![\p{L}])museum[- ](?:district|mile|row|quarter|square|hill|campus|park|way|walk|plaza|place|street|avenue|drive|road|boulevard|lane|st|ave|dr|rd|blvd|ln|quality)(?![\p{L}])\.?/giu;

/** The business name without its museum-district words. Used by isSellable for this campaign too. */
export function museumWordsOut(name) {
    return String(name ?? '').replace(MUSEUM_PLACE, ' ');
}

/**
 * Not buyers: museums, art centers, arts councils, public art, university
 * and college galleries, foundations, art leagues and guilds. Matched on the
 * name (museum-district words removed) and the Maps category. "Arts
 * District" is a neighbourhood (Los Angeles), so it is not on the list.
 */
const NONPROFIT_ART = words([
    'museums?', 'art(?:s)? cent(?:er|re)s?', 'cent(?:er|re) for (?:the )?(?:arts?|visual arts|contemporary arts?|photography|craft)',
    'arts? council', 'council (?:on|for) the arts', 'public art', 'arts? commission', 'arts? (?:alliance|league|association|guild|society|foundation|coalition|collaborative|partnership|organi[sz]ation|institute|trust)',
    'artists[\'’]? (?:guild|association|alliance|league)', 'art institute', 'institute of (?:contemporary )?arts?', 'community arts?',
    'non-?profit', 'not[- ]for[- ]profit', '501\\s?\\(?c\\)?\\s?\\(?3\\)?', 'universit(?:y|ies)', 'college', 'school of (?:the )?(?:arts?|design|visual arts|fine arts)',
    'foundation', 'kunsthalle', 'historical society', 'cultural (?:cent(?:er|re)|arts?|affairs)',
    // The world run: museums in every language and German compounds
    // (Kunstmuseum, Stadtmuseum, Moderna Museet), Kunsthallen and art
    // associations (Kunstverein, kunstforening), art and culture centres,
    // foundations (Fondation, Fundación, Fondazione, Fundação, Stiftung,
    // Stichting, FRAC), the public academies of fine arts, universities,
    // cultural associations, national and municipal galleries, city halls.
    ...['\\p{L}+museums?', 'mus[ée]es?', 'muse(?:o|os|i|u|us)', 'muzeum', '\\p{L}*museet', 'pinacotecas?',
        'kunsthal(?:len)?', 'konsthall(?:en)?', 'kunstverein\\p{L}*', 'kunstforening(?:en)?', 'konstförening(?:en)?', 'kunstnerforbund\\p{L}*', 'kunstnernes hus',
        'kunstsammlung(?:en)?', 'kunstakademi\\p{L}*', 'kunsthochschule', 'akademie der bildenden künste', 'hochschule für (?:bildende )?künste',
        'centres? d[\'’]art(?: contemporain)?', 'centres? culturels?', 'centro (?:de |di |d[\'’])arte', 'centros? culturai?s?', 'centro culturale', 'kulturzentrum', 'kulturhaus', 'kulturhuset',
        'casa de (?:la )?cultura', 'maison de la culture', 'cultureel centrum',
        'fondation', 'fundaci[oó]n', 'fondazione', 'funda[cç][aã]o', 'fundació', 'stiftung', 'stichting', 'fonds régional', 'frac',
        'école (?:nationale |supérieure |municipale |régionale )?des beaux-arts', 'accademia (?:di|delle) belle arti', '(?:academia|escuela|escola) de (?:bellas|belas) artes', 'academie (?:voor|van) beeldende kunsten?',
        'universit(?:é|à|ät|eit|et|ad|ade|ario|aria)', 'associazione culturale', 'asociaci[oó]n cultural', 'association culturelle', 'kunstvereniging',
        'galleria (?:nazionale|civica|comunale|regionale)', 'nationalgalerie', 'staatsgalerie', 'stadtgalerie', 'städtische galerie', 'galerie (?:municipale|nationale)',
        'galer[ií]a (?:municipal|nacional)', 'ayuntamiento', 'municipalidad', 'prefeitura', 'comune di', 'gemeente'],
], WHOLE, {
    // Museums, art and culture centres, the artists' houses and workshops
    // (בית האמנים, סדנאות האמנים), Ein Harod's משכן לאמנות, community
    // centres, non-profits (עמותה, ע"ר, אגודת…), universities and colleges,
    // the municipal galleries, city councils, archives and arts foundations.
    he: ['מוזיאון', 'מוזאון', 'מרכז (?:ל|ה)?(?:אמנות|אומנות|תרבות)', 'היכל (?:ה)?תרבות', 'בית (?:ה)?אמנים', 'סדנאות (?:ה)?אמנים', 'משכן (?:ל)?(?:אמנות|אומנות)',
        'מתנ["״]ס', 'עמות(?:ה|ת)', 'אגודת', 'ע["״]ר' + HE_END, 'אוניברסיט', 'מכלל(?:ה|ת)', 'גלרי(?:ה|ית) ה?עירונית', 'עיריית', 'מועצה (?:ה)?(?:מקומית|אזורית)',
        'ארכיון', 'קרן (?:ל|ה)?(?:אמנות|אומנות|תרבות)'],
    // Art museums and museums, art centres, foundations, universities, and
    // the public ones (municipal, prefectural, national).
    cjk: ['美術館', '美术馆', '博物館', '博物馆', '미술관', '박물관', 'アートセンター', '아트센터', '藝術中心', '艺术中心', '文化センター', '文化中心', '문화재단',
        '基金會', '基金会', '財団', '재단', '大学', '大學', '대학교', '市立', '県立', '都立', '府立', '国立', '國立', '국립', '시립', '公立'],
});
/** The Maps description says so: "Non-profit gallery…", "University gallery…". */
const NONPROFIT_DESCRIPTION = words(['non-?profit', 'not[- ]for[- ]profit', '501\\s?\\(?c\\)?\\s?\\(?3\\)?', '(?:university|college)(?:[\'’]s)? (?:art )?(?:gallery|museum)',
    'registered charity', 'sans but lucratif', '(?:à|a) but non lucratif', 'gemeinnützig\\p{L}*', 'senza scopo di lucro', 'sin (?:ánimo|animo|fines) de lucro', 'sem fins lucrativos', 'zonder winstoogmerk', 'ideell förening'], WHOLE, {
    he: ['ללא מטרות רווח', 'מלכ["״]ר'],
    cjk: ['非営利', '비영리', '非營利', '非营利'],
});
/**
 * …or the website: "X is a 501(c)(3) non-profit". "A portion goes to a
 * non-profit" is not this. Hebrew: "…היא עמותה", "עמותה רשומה", and a
 * registered non-profit's number (ע"ר 58-…).
 */
const NONPROFIT_SITE = words(['(?:is|are) an? (?:registered |independent |private |public |community )?(?:non-?profit|not[- ]for[- ]profit|501\\s?\\(?c\\)?\\s?\\(?3\\)?)',
    // A UK charity's footer; "… ist ein gemeinnütziger Verein", "association loi 1901", "… è un'associazione senza scopo di lucro",
    // "… es una fundación sin ánimo de lucro", "… é uma associação sem fins lucrativos", "… is een stichting zonder winstoogmerk", ANBI.
    'registered charity (?:no\\.?|number|nº)', '(?:ist|sind) (?:ein|eine) (?:gemeinnützig\\p{L}*|eingetragener verein)', 'association (?:régie par la )?loi (?:de )?1901',
    '(?:association|fondation|organisme|structure) (?:à|a) but non lucratif', '(?:è|e) un[\'’]?(?:a )?(?:associazione|fondazione|organizzazione|ente)[^.!?;\\n]{0,30}?(?:senza scopo di lucro|no[- ]profit|non[- ]profit)',
    '(?:es|somos) una? (?:asociaci[oó]n|fundaci[oó]n|organizaci[oó]n|entidad)[^.!?;\\n]{0,30}?sin (?:ánimo|animo|fines) de lucro',
    '(?:é|somos) uma? (?:associa[cç][aã]o|funda[cç][aã]o|organiza[cç][aã]o|entidade|institui[cç][aã]o)[^.!?;\\n]{0,30}?sem fins lucrativos',
    '(?:is|zijn) een (?:stichting|vereniging)[^.!?;\\n]{0,30}?(?:zonder winstoogmerk|anbi)', 'anbi[- ]status'], WHOLE, {
    he: ['(?:היא|הינה|הנה|הוא|הינו|הנו) (?:עמותה|מלכ["״]ר|ארגון ללא מטרות רווח)', 'עמותה רשומה', 'ע["״]ר\\s*(?:מס[\'׳.]?\\s*)?58'],
    // Run by a foundation (運営: 公益財団法人…), a Japanese NPO's legal name.
    cjk: ['運営[：:\\s]*(?:公益|一般)?(?:財団|社団)法人', '特定非営利活動法人'],
});

/**
 * Is this an art organisation we cannot sell through? Called by isSellable
 * (relevance.js) for the art campaign, so these places are dropped at the
 * feed like synagogues are in a Judaica run.
 * @returns {string} the reason, or '' when it is not one
 */
export function artNonProfit(lead) {
    let name = clean(museumWordsOut(lead.business_name));
    // A company (בע"מ) is commercial, whatever its Hebrew name says.
    if (HE_COMPANY.test(name)) name = name.replace(/[֐-׿"״'׳]+/g, ' ');
    const category = clean(lead.category);
    const hit = find(NONPROFIT_ART, name).words[0] || find(NONPROFIT_ART, category).words[0]
        || find(NONPROFIT_DESCRIPTION, clean(lead.maps_description)).words[0]
        // "Kunsthaus Zürich" is a museum, "Kunsthaus Lempertz" an auction house.
        || (KUNSTHAUS.test(name) && !has(AUCTION, `${name} · ${category}`) && !has(DEALER, `${name} · ${category}`) && !COMPANY_FORM.test(name) ? 'kunsthaus' : '');
    return hit ? `non-profit / museum (${hit})` : '';
}
const KUNSTHAUS = /(?<![\p{L}])kunsthaus(?![\p{L}])/iu;
/** A company's legal form: GmbH, AG, KG, SA, SRL, SL, Ltd, BV, KK (株式会社)… */
const COMPANY_FORM = /(?<![\p{L}])(?:gmbh|ag|kg|ohg|sa|sas|sarl|srl|s\.r\.l\.|spa|s\.p\.a\.|sl|s\.l\.|ltda?|bv|nv|ab|as|aps|oy|pty|llc|inc)(?![\p{L}])|株式会社|有限会社|㈱/iu;

// ─── Not buyers ───────────────────────────────────────────────────────────

/** Picture framers. Many "art galleries" on Maps are frame shops (Hebrew: מסגרות, מסגור, מסגרייה). */
const FRAME = words(['fram(?:e|es|ed|er|ers|ing)', 'framemak\\w*', 'framery',
    // Encadrement, Bilderrahmen, Einrahmung, Cornici, Marquería, Molduras, Lijstenmakerij, Inramning, Rammeverksted.
    'encadr\\p{L}*', 'bilderrahm\\p{L}*', 'einrahm\\p{L}*', 'rahmen\\p{L}*', 'rahmung', 'cornic(?:i|iaio|iai|eria|erie)', 'marquer[ií]as?', 'enmarca\\p{L}*',
    'moldur(?:a|as|aria|arias)', 'lijsten\\p{L}*', 'inlijst\\p{L}*', 'inramning\\p{L}*', 'ramaffär', 'rammeverksted', 'indramning\\p{L}*', 'rammemager\\p{L}*',
], WHOLE, { he: ['מסגרות', 'מסגור', 'מסגרי', 'ממסגר', 'מסגרת'], cjk: ['額縁', '額装', '額屋', '액자', '畫框', '画框', '裱框', '裝裱', '装裱'] });

/**
 * Categories that are never a buyer, whatever the name says: art supplies,
 * classes and schools, paint-and-sip, tattoo, printing, photographers,
 * interiors and furniture, house and mural painters, conservators, and
 * everything that is not about art at all (cafés, bars, venues, malls).
 */
const NOT_BUYER_CATEGORY = words([
    'art suppl(?:y|ies)', 'art (?:store|materials)', 'craft (?:store|supply|supplies)', 'hobby (?:store|shop)', 'paint (?:store|manufacturer)', 'stationery',
    'art (?:school|class(?:es)?|lessons?|camps?|academy|education|instruction|workshops?)', 'painting (?:class(?:es)?|lessons?|school|studio)', 'drawing (?:class(?:es)?|lessons?)',
    'pottery (?:class(?:es)?|studio|lessons?)', 'ceramics? (?:class(?:es)?|studio)', 'paint[- ]your[- ]own', 'schools?', 'academy', 'tutor\\w*', 'children\\w*',
    'tattoo\\w*', 'piercing',
    'print (?:shop|lab|studio|services?)', 'printing', 'printers?', 'copy (?:shop|cent(?:er|re))', 'screen ?print\\w*', 'sign (?:shop|maker)\\w*', 'graphic design\\w*',
    'photo (?:lab|shop|store|studio|booth)', 'photographers?', 'photography (?:studio|services?|school)', 'portrait studio', 'videograph\\w*', 'camera',
    'interior (?:design|decorat|architect)\\w*', 'decorators?', 'home staging', 'furniture', 'home (?:goods|d[eé]cor|furnishings?|improvement)', 'mattress', 'rugs?', 'carpet', 'lighting', 'kitchen', 'cabinet\\w*',
    'murals?', 'muralists?', 'painters?', 'painting (?:contractor|company|services?)', 'graffiti',
    'conservat(?:or|ion)\\w*', 'restoration', '(?:art|fine art) (?:handling|shipping|storage|installation)', 'picture hanging', 'installation services?', 'storage', 'moving', 'movers', 'shipping', 'crating', 'packing',
    'restaurant', 'caf[eé]s?', 'coffee', 'bars?', 'pubs?', 'brewery', 'winery', 'wine', 'hotel', 'inn', 'apartments?', 'apartment (?:building|complex)', 'condominium', 'lofts?', 'real estate', 'realty',
    '(?:event|wedding|banquet|party) (?:venue|hall|space)', 'venue', 'theat(?:er|re)', 'cinema', 'performing arts', 'music', 'dance', 'salon', 'spa', 'barber', 'church', 'shopping (?:mall|cent(?:er|re))', 'mall',
    'jewel\\w*', 'clothing', 'boutique', 'florist', 'toy', 'book ?(?:store|shop)', 'thrift', 'consignment shop', 'pawn', 'coins?', 'gold', 'tourist attraction', 'park', 'garden',
]);

/** …and names that say the same, under any category ("Pinot's Palette" is filed as an "Art gallery"). */
const NOT_BUYER_NAME = words([
    'tattoo\\w*', 'paint(?:ing)?\\s*(?:and|&|n|[\'’]n[\'’]?)\\s*sip', 'sip\\s*(?:and|&|n|[\'’]n[\'’]?)\\s*paint', 'pinot[\'’]?s palette', 'painting with a twist',
    'paint ?bar', 'paint your own', 'color me mine', 'wine (?:and|&) (?:design|canvas)', 'board (?:and|&) brush',
    'art suppl(?:y|ies)', 'art (?:school|class(?:es)?|lessons?|camps?|academy)', 'kids?[\'’]? art', 'children[\'’]?s art',
    'print shop', 'printing', 'copy cent(?:er|re)', 'interiors?', 'interior design\\w*', 'furniture', 'murals?', 'muralists?',
    'restoration', 'conservation', 'art handling', 'home staging',
    // Tattoo, painting schools and classes, art supplies, printers, copy shops, restorers, interior designers, furniture.
    'tätowier\\p{L}*', 'malschule', 'kunstschule', 'malkurs\\p{L}*', 'künstlerbedarf', 'malbedarf', 'école d[\'’]art', 'cours de (?:peinture|dessin)', 'scuola d[\'’]arte',
    'corsi di (?:pittura|disegno)', 'escuela de arte', 'clases de (?:pintura|dibujo)', 'escola de arte', 'aulas de (?:pintura|desenho)', 'tekenschool', 'schildercursus\\p{L}*',
    'imprimerie', 'druckerei', 'tipograf[ií]a', 'copisteria', 'copistería', 'restaurierung', 'restaurator\\p{L}*', 'restauro', 'restauratie\\p{L}*',
    'innenarchitekt\\p{L}*', 'raumausstatt\\p{L}*', 'arredamento', 'interiorismo', 'möbel\\p{L}*',
], WHOLE, {
    // Craft and art-supply shops, classes and workshops, art schools,
    // tattoo, printers, interior design, furniture, restoration.
    he: ['חנות (?:ל)?(?:יצירה|חומרי)', 'חומרי (?:אמנות|אומנות|יצירה|ציור)', 'חוג(?:י|ים)? (?:ל)?(?:ציור|אמנות|אומנות|יצירה|קרמיקה|פיסול)', 'סדנ(?:ה|ת|אות) (?:ל)?(?:ציור|אמנות|אומנות|יצירה|קרמיקה|פיסול)',
        'בית ספר (?:ל)?(?:אמנות|אומנות|ציור)', 'קעקוע', 'טאטו', 'בית דפוס', 'דפוס' + HE_END, 'הדפסות', 'עיצוב פנים', 'מעצב(?:ת)? פנים', 'רהיטים', 'רסטורציה', 'שחזור (?:ציורים|יצירות)'],
    cjk: ['画材', '畫材', '화방', '미술학원', '絵画教室', 'アート教室', '타투', 'タトゥー', '刺青', '纹身', '紋身', '印刷'],
});
/** The Maps description of a paint-and-sip studio or tattoo parlour. */
const NOT_BUYER_DESCRIPTION = words(['tattoo\\w*', 'paint(?:ing)?\\s*(?:and|&|n)\\s*sip', 'sip\\s*(?:and|&|n)\\s*paint', 'bring your own (?:wine|bottle|byob)']);

/** An artist's own studio sells its own work, not anyone else's. */
const ARTIST_CATEGORY = words(['artists?', 'art studio', 'sculptors?', 'potters?', 'ceramicists?', 'glass ?blow\\w*', 'craftsm[ae]n', 'art handcraft']);
const ARTIST_NAME = words(['studios?', 'atelier', 'photography', 'photographer', 'photos?', 'ateli(?:ê|e)', 'fotograf(?:ie|ia|ía|i|o|a|en)?', 'photographie', 'taller', 'werkstatt'], WHOLE, {
    he: ['סטודיו', 'צילום', 'צלם'],
    cjk: ['アトリエ', 'スタジオ', '工房', '스튜디오', '작업실', '공방', '工作室'],
});
/** Gift, souvenir and craft shops. */
const GIFT_CATEGORY = words(['gifts?', 'gift shop', 'souvenirs?', 'handicrafts?', 'crafts?', 'novelty']);

/** Gallery: גלריה, גלריית, גלריות (and גלרית, as some names spell it). */
const GALLERY_HE = ['גלרי'];
/** …Galleri(et), Galerij, Galerías, Galerien, Kunstgalerie; ギャラリー, 画廊, 갤러리, 화랑, 藝廊 (Galerie, Galleria, Galería, Galeria are the English pattern's). */
const GALLERY_OTHER = ['gall?er(?:i|iet|ij|ijen|ías|ias|ien)', '(?:kunst|konst)gall?er\\p{L}*'];
const GALLERY_CJK = ['ギャラリー', '画廊', '畫廊', '갤러리', '화랑', '藝廊', '艺廊'];
/** Auction: מכירה פומבית, מכירות פומביות, בית מכירות פומביות. */
const AUCTION_HE = ['מכיר(?:ה|ות) ה?פומבי'];
/**
 * Auktionshaus / Kunstauktionen / Auktionshus, enchères, Hôtel des ventes,
 * maison de ventes, commissaire-priseur, casa d'aste, aste, subastas,
 * leilões / leiloeiro, veilinghuis. (No end: these go into AUCTION, which has none.)
 */
const AUCTION_OTHER = ['auktion\\p{L}*', '\\p{L}+auktion\\p{L}*', 'ench[èe]res', 'h[ôo]tel des ventes', 'maisons? de ventes?', 'commissaires?[- ]priseurs?', 'case? d[\'’]aste',
    'aste(?![\\p{L}])', 'asta(?![\\p{L}])', 'subastas?', 'leil(?:ão|ões|ao|oes)', 'leiloeir\\p{L}*', 'veiling\\p{L}*', '\\p{L}+veiling\\p{L}*'];
const AUCTION_CJK = ['オークション', '競売', '경매', '옥션', '拍賣', '拍卖'];
/** Dealer, in a name: סוחר / סוחרת (אמנות), סחר; Händler, marchand, mercante, marchante. */
const DEALER_NAME_HE = ['סוח(?:ר|רת|רי)' + HE_END, 'סחר' + HE_END];
const DEALER_NAME_OTHER = ['händler\\p{L}*', 'marchand(?:e|s)?', 'mercant(?:e|i)', 'marchantes?'];
/** Advisory, in a name next to art words: יועץ / יועצת, ייעוץ, and the independent curator (אוצר / אוצרת); Beratung, conseil, consulenza, asesoría, advies… */
const ADVISOR_NAME_HE = ['יוע(?:ץ|צת|צים|צות)', 'ייעוץ', 'אוצר(?:ת)?' + HE_END];
const ADVISOR_NAME_OTHER = ['beratung', 'berater\\p{L}*', 'conseils?', 'consulen(?:za|te|ti)', 'asesor\\p{L}*', 'consultor\\p{L}*', 'assessoria', 'advies', 'adviseur\\p{L}*', 'rådgiv\\p{L}*'];
const ADVISOR_NAME_CJK = ['コンサル', 'アドバイザー', '컨설팅', '자문', '顧問', '顾问'];

/** The words a buyer puts in its name. */
const BUYER_NAME = words(['gall?er(?:y|ies|ie|ia|ía)', 'auction\\w*', 'dealers?', 'advis\\w*', 'consult\\w*', ...GALLERY_OTHER, ...AUCTION_OTHER, ...DEALER_NAME_OTHER, ...ADVISOR_NAME_OTHER], WHOLE, {
    he: [...GALLERY_HE, ...AUCTION_HE, ...DEALER_NAME_HE, ...ADVISOR_NAME_HE],
    cjk: [...GALLERY_CJK, ...AUCTION_CJK, ...ADVISOR_NAME_CJK],
});
const GALLERY = words(['gall?er(?:y|ies|ie|ia|ía)', ...GALLERY_OTHER], WHOLE, { he: GALLERY_HE, cjk: GALLERY_CJK });
const FINE_ART = words(['fine arts?']);

/** Categories a buyer can have: art, galleries, auction, antiques, appraisers, consultants. ("Car dealer" is not one.) */
const ART_CATEGORY = words(['art', 'arts', 'fine arts?', 'gall?er\\w*', 'auction\\w*', 'antiques?', 'antiquarian', 'apprais\\w*', 'consult\\w*', 'advis\\w*', 'collectibles?', ...GALLERY_OTHER, ...AUCTION_OTHER], WHOLE, {
    // Maps' English UI names categories in English; a few come in Hebrew ("מסעדה" in the sushi run) or another language.
    he: [...GALLERY_HE, ...AUCTION_HE, 'אמנות', 'אומנות', 'עתיקות'],
    cjk: [...GALLERY_CJK, ...AUCTION_CJK, '美術', '미술', 'アート'],
});
/** Categories that say nothing: an advisor is often a "Corporate office" or a "Consultant". */
const GENERIC_CATEGORY = /^(store|shop|business|company|corporate office|offices?|service|establishment|point of interest|business center|management company|)$/i;
const ANTIQUE = words(['antiques?', 'antiquarian']);
const APPRAISER = words(['apprais\\w*']);
/** Art words for antique shops, appraisers and names that say nothing else. */
const ART_WORD = words(['art', 'arts', 'artworks?', 'fine arts?', 'paintings?', 'gall?er(?:y|ies|ie|ia|ía)', 'collect(?:ors?|ions?|ing)',
    // Kunst, d'art, arte, beaux-arts / bellas artes / belle arti, paintings, works of art, collections.
    'kunst', 'konst', 'd[\'’]art', 'arte', 'beaux-arts', 'bellas artes', 'belas artes', 'belle arti', 'peintures?', 'tableaux', 'gemälde', 'dipinti', 'pinturas?', 'schilderijen',
    'kunstwerke?', '(?:œuvres?|oeuvres?) d[\'’]art', 'obras? de arte', 'opere d[\'’]arte', 'colecci[oó]n(?:es)?', 'cole[cç](?:ão|ao|ões|oes)', 'collezion[ei]', 'sammlung(?:en)?', ...GALLERY_OTHER], WHOLE, {
    // Art, arts, artists (not אמן alone: it is also "amen"), paintings, works, sculpture, collectors.
    he: [...GALLERY_HE, 'אמנות', 'אומנות', 'אמנויות', 'אמנ(?:ים|ית|יות)' + HE_END, 'ציור(?:ים)?' + HE_END, 'יצירות', 'פיסול', 'אספנ'],
    cjk: ['美術', 'アート', '미술', '아트', '藝術', '艺术', ...GALLERY_CJK],
});

// ─── What kind of buyer ───────────────────────────────────────────────────

/** "Auction", "Auctions", "Auctioneers", "Auction house"; "מכירה פומבית", "בית מכירות פומביות". */
const AUCTION = words(['auction\\w*', ...AUCTION_OTHER], '', { he: AUCTION_HE, cjk: AUCTION_CJK });
/** Art advisory and consulting, from any text: "יועצת אמנות", "ייעוץ באמנות", "ייעוץ לאספנים", building and managing collections. */
const ADVISOR = words(['art[- ](?:advis|consult)\\w*', '(?:fine[- ]art|collection|collections|curatorial|corporate art) (?:advis|consult)\\w*', 'art acquisition', 'collection management', 'corporate art (?:collections?|programs?|services)',
    // Conseil en art, Kunstberatung, kunstadvies, konstrådgivning, consulenza artistica, asesoría de arte, consultoria de arte.
    'conseil(?:s|ler|lère|lers)? en (?:art|œuvres d[\'’]art|oeuvres d[\'’]art)', 'kunstberat\\p{L}*', 'konstrådgiv\\p{L}*', 'kunstrådgiv\\p{L}*', 'kunstadvi\\p{L}*',
    'consulen(?:za|te|ti) (?:artistic[ao]|d[\'’]arte|in arte)', 'asesor(?:ía|ia|es|a|as)? (?:de|en) arte', 'asesor(?:ía|ia) artística', 'consultor(?:ía|ia|es|a)? (?:de|en) arte',
    'consultoria (?:de|em) arte', 'assessoria (?:de|em) arte'], WHOLE, {
    he: ['יוע(?:ץ|צת|צי|צות) (?:ל)?(?:אמנות|אומנות)', 'ייעוץ (?:ל|ב)?(?:אמנות|אומנות)', 'ייעוץ (?:ל)?אספנים', 'בניית אוספ', 'ניהול אוספ'],
    cjk: ['アートコンサル\\p{L}*', 'アートアドバイザー', '아트 ?컨설팅', '미술 ?컨설팅', '藝術顧問', '艺术顾问'],
});
/** In a name, "Advisory" or "Consulting" alone is enough once the listing is about art. */
const ADVISOR_NAME = words(['advis(?:ory|ors?|ers?|ing)', 'consult(?:ants?|ancy|ing)', 'curat(?:orial|ion) services', ...ADVISOR_NAME_OTHER], WHOLE, { he: ADVISOR_NAME_HE, cjk: ADVISOR_NAME_CJK });
const DEALER = words([
    '(?:fine[- ]art|art|private|art (?:and|&) antiques?|antiques? (?:and|&) (?:fine )?art) dealers?', 'dealers? (?:in|of) (?:[\\p{L}-]+ ){0,3}(?:art|paintings|prints|photographs|sculpture)',
    'private (?:sales|treaty)', 'secondary market',
    'we(?:[\'’]re| are)? (?:always |actively |currently )?(?:buy|buying|purchas\\w*|acquir\\w*)(?: and sell(?:ing)?)?[^.!?;\\n]{0,30}?(?:art|artworks?|paintings?|collections?|estates?|prints|sculptures?|photographs|works)',
    '(?:buying|purchasing) (?:fine )?(?:art|artworks?|paintings|collections|estates)',
    // Kunsthandel / Kunsthändler / konsthandel, marchand d'art, mercante d'arte, marchante de arte; "we buy…" in each language.
    'kunsthand(?:el|els|lung|ler|lerin)', 'kunsthandelaars?', 'kunsthändler\\p{L}*', 'konsthand(?:el|lare|lar)', 'marchands? d[\'’]art', 'mercant(?:e|i) d[\'’]arte',
    '(?:marchantes?|comerciantes?|negociantes?) de arte',
    'nous achetons[^.!?;\\n]{0,30}?(?:œuvres?|oeuvres?|tableaux|art|collections?|successions?)', 'wir kaufen[^.!?;\\n]{0,30}?(?:kunst|gemälde|bilder|sammlungen|nachlässe|grafik)',
    '(?:an- und verkauf|ankauf) von (?:kunst|gemälden|bildern|grafik|sammlungen|nachlässen)', 'acquistiamo[^.!?;\\n]{0,30}?(?:opere|dipinti|quadri|collezioni)',
    'compramos[^.!?;\\n]{0,30}?(?:obras?|arte|cuadros|quadros|pinturas|colecciones|cole[cç][õo]es)', 'wij kopen[^.!?;\\n]{0,30}?(?:kunst|schilderijen|collecties)',
    'vi köper[^.!?;\\n]{0,30}?(?:konst|tavlor|samlingar)',
], WHOLE, {
    // Art dealer, art trade, buying and selling art, "we buy art / collections / estates".
    he: ['סוח(?:ר|רת|רי) (?:ה)?(?:אמנות|אומנות|יצירות)', 'סחר (?:ב)?(?:אמנות|אומנות)', '(?:קונים|קנייה|קניה) ומ(?:וכרים|כירה|כירת) (?:של )?(?:אמנות|אומנות|יצירות|ציורים)',
        '(?:אנו|אנחנו) קונים[^.!?;\\n]{0,30}?(?:אמנות|אומנות|יצירות|ציורים|אוספים|עזבונות)'],
    // Art dealers (画商, 美術商) and art buying (美術品買取).
    cjk: ['画商', '美術商', '畫商', '美術品(?:の)?買取'],
});
const DEALER_NAME = words(['dealers?', ...DEALER_NAME_OTHER], WHOLE, { he: DEALER_NAME_HE });

/** A gallery's website: exhibitions and the artists it represents. */
const EXHIBITIONS = words(['(?:current|upcoming|past|recent|future|new|forthcoming) exhibitions?', 'exhibitions? (?:on view|opening|calendar|schedule|archive|history)', 'now on view', 'on view (?:through|until|now)', 'opening reception',
    // The same in German, French, Italian, Spanish, Portuguese, Dutch, Swedish, Danish and Norwegian; an opening (Vernissage, inaugurazione).
    '(?:aktuelle|aktuellen|kommende|kommenden|vergangene|vergangenen|laufende|nächste|frühere) ausstellung(?:en)?', 'ausstellungsarchiv', 'vernissage',
    '(?:expositions?|expos?) (?:en cours|à venir|a venir|passées?|actuelles?|précédentes|futures)', 'prochaines? expositions?',
    '(?:mostra|mostre) (?:in corso|attual[ei]|passate|precedenti|future|in programma)', '(?:prossima|prossime) mostr[ae]', 'inaugurazione',
    'exposici(?:ón|on|ones) (?:actual(?:es)?|en curso|pasadas?|anteriores|próximas?|proximas?|vigentes?)', '(?:próximas?|proximas?) exposici(?:ón|on|ones)', 'inauguración',
    'exposi[cç](?:ão|ao|ões|oes) (?:atua(?:l|is)|em cartaz|passadas?|anteriores|futuras?|em curso)', '(?:próximas?|proximas?) exposi[cç](?:ão|ao|ões|oes)', 'em cartaz',
    '(?:huidige|komende|lopende|vorige|eerdere|actuele) (?:tentoonstelling|expositie)(?:en|s)?',
    '(?:aktuell|aktuella|pågående|kommande|tidigare) utställning(?:ar|en)?', '(?:aktuelle?|kommende|tidligere|nuværende|nåværende) (?:udstilling|utstilling)(?:er|en)?'], WHOLE, {
    // Current, past and upcoming exhibitions, an exhibition opening, "on view now". "תערוכות" alone is an artist's CV too.
    he: ['תערוכ(?:ה|ות) (?:ה)?(?:נוכחי(?:ת|ות)|קודמ(?:ת|ות)|עבר|הבא(?:ה|ות)|קרוב(?:ה|ות)|עתידי(?:ת|ות)|מתוכננ(?:ת|ות))', 'פתיחת (?:ה)?תערוכ', 'מוצג(?:ת|ות|ים)? כעת'],
    cjk: ['開催中', '過去の展覧会', '今後の展覧会', '次回展覧会', '現在の展覧会', '展覧会情報', '현재 ?전시', '지난 ?전시', '예정 ?전시', '전시 ?중', '진행 ?중인 ?전시', '과거 ?전시',
        '當前展覽', '当前展览', '現正展出', '现正展出', '過往展覽', '过往展览', '即將展覽', '即将展览'],
});
/** "Our artists" is never a single artist's own site, but "Exhibitions" is (the CV). */
const REPRESENTED = words(['(?:represented|gallery|our) artists', 'artists represented', '(?:the gallery|we) represents?', 'represent(?:s|ing)?[^.!?;\\n]{0,40}?artists',
    // Künstler der Galerie, nos artistes, i nostri artisti, nuestros / nossos artistas, onze kunstenaars, våra konstnärer…, and "the gallery represents".
    'künstler(?:innen)? der galerie', 'galeriekünstler\\p{L}*', 'unsere künstler\\p{L}*', 'vertretene künstler\\p{L}*', 'die galerie vertritt', 'vertritt[^.!?;\\n]{0,40}?künstler\\p{L}*',
    'artistes (?:de la galerie|représentés)', 'nos artistes', 'la galerie représente', 'représente[^.!?;\\n]{0,40}?artistes',
    'artisti (?:della galleria|rappresentati)', 'i nostri artisti', 'la galleria rappresenta', 'rappresenta[^.!?;\\n]{0,40}?artisti',
    'artistas (?:de la galer[ií]a|da galeria|representad[oa]s)', 'nuestros artistas', 'nossos artistas', '(?:la|a) galer[ií]a representa', 'representa[^.!?;\\n]{0,40}?artistas',
    'kunstenaars van de galerie', 'onze kunstenaars', 'galeriekunstenaars', 'vertegenwoordigt[^.!?;\\n]{0,40}?kunstenaars',
    'våra konstnärer', 'galleriets (?:konstnärer|kunstnere)', 'representerar[^.!?;\\n]{0,40}?konstnärer', 'vores kunstnere', 'våre kunstnere', 'repr(?:æ|e)senterer[^.!?;\\n]{0,40}?kunstnere'], WHOLE, {
    he: ['אמני (?:ה)?גלרי', '(?:ה)?אמנים שלנו', 'אמנים מיוצגים', '(?:ה)?גלרי(?:ה|יה) מייצגת', 'מייצג(?:ת|ים)?[^.!?;\\n]{0,40}?אמנים'],
    cjk: ['取扱作家', '取り扱い作家', '所属作家', '전속 ?작가', '소속 ?작가', '代理藝術家', '代理艺术家', '合作藝術家', '合作艺术家'],
});
const GALLERY_TEXT = words(['gall?er(?:y|ies|ie|ia|ía)', 'exhibitions?', 'represent(?:s|ing)? (?:[\\p{L}-]+ ){0,3}artists', ...GALLERY_OTHER,
    'expositions?', 'ausstellung(?:en)?', 'mostr[ae]', 'exposici(?:ón|on|ones)', 'exposi[cç](?:ão|ao|ões|oes)', 'tentoonstelling(?:en)?', 'utställning(?:ar)?', '(?:udstilling|utstilling)(?:er)?'], WHOLE, {
    he: [...GALLERY_HE, 'תערוכ'],
    cjk: [...GALLERY_CJK, '展覧会', '展示会', '전시', '展覽', '展览'],
});

/**
 * What the text says the place is. Auction first, the most specific; a
 * gallery last, because dealers and advisors also call their rooms galleries.
 * `name`: in a name, "Advisory" or "Dealer" alone counts (with art around).
 */
function typeIn(text, { name = false, art = false } = {}) {
    if (has(AUCTION, text)) return 'auction_house';
    if (has(ADVISOR, text) || (name && art && has(ADVISOR_NAME, text))) return 'art_advisor';
    if (has(DEALER, text) || (name && has(DEALER_NAME, text))) return 'dealer';
    if (has(name ? GALLERY : GALLERY_TEXT, text)) return 'gallery';
    return '';
}

/** What the website says the place is, when the listing doesn't. One stray "auction" is a charity gala. */
function siteType(site) {
    if (find(AUCTION, site).count >= 2) return 'auction_house';
    if (has(ADVISOR, site)) return 'art_advisor';
    if (has(DEALER, site)) return 'dealer';
    if (has(EXHIBITIONS, site) || has(REPRESENTED, site)) return 'gallery';
    return '';
}

// ─── Submissions and consignments ─────────────────────────────────────────

/** "do not", "doesn't", "won't", "cannot", "are unable to", "no longer". */
const NEG = "(?:(?:do|does|did|will|can|could|are|is|am|were|was|would|shall)\\s+not|(?:don|doesn|didn|won|can|couldn|aren|isn|wasn|weren|wouldn)['’]?t|cannot|unable to|no longer|never)";
/** "…not currently accepting", "…not able to review", "…not at this time accept". */
const ADVERBS = '(?:\\s+(?:currently|presently|now|actively|generally|be|able to|in a position to|at (?:this|the present) time|at present|any ?more|accept or|review or))*';
/** The words allowed between the verb and what is refused: "accept any unsolicited artist submissions". */
const BETWEEN = "(?:\\s+(?:any|unsolicited|new|artist|artists['’]?|artist['’]s|outside|external|additional|further|digital|e-?mail(?:ed)?|physical|online|walk-in|in-person|general|our|your|of|for|or|and|from|by|via|on|to|at|the|a|an))*";

/**
 * A gallery that says it does not want artists' work. The usual phrasings:
 * "We do not accept unsolicited submissions", "The gallery is not currently
 * accepting new artists", "We are unable to review portfolios", "Unsolicited
 * submissions will not be reviewed", "Submissions are closed", "Please do
 * not send portfolios", "No unsolicited submissions", "Exhibitions are by
 * invitation only".
 */
const NO_SUBMISSIONS = [
    // "…submissions via Instagram" is a rule about how to send, not a refusal.
    new RegExp(`(?<![\\p{L}])${NEG}${ADVERBS}\\s+(?:accept|review|consider|tak(?:e|es|ing)|look(?:ing)? (?:at|for)|seek|solicit|evaluat|represent|open|offer|schedul|conduct|hold)\\w*${BETWEEN}\\s+(?:submissions?|portfolios?|proposals?|new artists|new representation|representation|open calls?|unsolicited\\s+[\\p{L}]+)(?![\\p{L}\\p{N}])(?!\\s+(?:via|by (?:e-?mail|mail|post|phone|fax|hand|dm)|through|over the phone|on (?:social|instagram|facebook)|in person|other than|except|unless|without))`, 'iu'),
    new RegExp(`(?<![\\p{L}])unsolicited\\s+(?:[\\p{L}'’]+\\s+){0,2}(?:(?:will|shall|are|is|can|could)\\s*(?:not|n['’]t)|cannot)\\s+(?:be\\s+)?(?:accepted|reviewed|considered|returned|answered|opened|acknowledged|responded to)`, 'iu'),
    /\b(?:submissions?|portfolios?)\s+(?:are|is)\s+(?:currently\s+|now\s+|temporarily\s+)?closed\b/i,
    /\b(?:closed|not open)\s+(?:to|for)\s+(?:(?:new|artist|unsolicited)\s+)*submissions\b/i,
    /\bno\s+unsolicited\s+(?:submissions|portfolios|proposals|materials|work)\b/i,
    /\bno\s+(?:artist\s+)?(?:submissions|portfolios),?\s+please\b/i,
    new RegExp(`\\bplease\\s+${NEG}\\s+(?:send|submit|e-?mail|mail|drop off|bring)\\s+(?:us\\s+)?(?:your\\s+|any\\s+)?(?:unsolicited\\s+)?(?:portfolios?|submissions?|proposals?|images of (?:your )?work)`, 'i'),
    /\b(?:submissions?|representation|exhibitions?|artists)\b[^.!?;\n]{0,40}?\bby (?:invitation|referral) only\b/i,
    // Hebrew: "איננו מקבלים הגשות", "לא מקבלים פניות", "אין קבלת עבודות",
    // "סגור להגשות", "ההגשות נסגרו", "נא לא לשלוח תיקי עבודות", "ייצוג
    // בהזמנה בלבד". Works refused "למכירה" (for sale) are consignments.
    // "…בדואר, רק דרך הטופס" (by mail; only through the form) is a rule about how to send.
    new RegExp(`(?<![\\p{L}])(?:אין|איננו|אינה|אינם|אנו לא|אנחנו לא|הגלריה לא|לא)\\s+(?:מקבל(?:ים|ת|ות)?|נקבל|בוחנ(?:ים|ת)|מטפל(?:ים|ת)|מתקבל(?:ות|ים)?)[^.!?;\\n]{0,30}?(?:הגשות|תיקי עבודות|תיק עבודות|פניות|עבודות|יצירות|אמנים חדשים)(?!\\s*(?:(?:ל|ב)?מכיר|דרך|באמצעות|ב(?:דואר|מייל|אימייל|וואטסאפ|פייסבוק|אינסטגרם|טלפון|הודעה)))`, 'u'),
    new RegExp(`(?<![\\p{L}])אין קבלת (?:עבודות|הגשות|תיקי עבודות|תיק עבודות|אמנים|פניות)(?!\\s*(?:ל|ב)?מכיר)`, 'u'),
    new RegExp(`(?<![\\p{L}])(?:נא|אנא)?\\s*(?:לא|אין) לשלוח (?:לנו )?(?:תיקי עבודות|תיק עבודות|עבודות|הגשות|יצירות)`, 'u'),
    new RegExp(`(?<![\\p{L}])(?:ה)?הגש(?:ה|ות)\\s+(?:סגור(?:ה|ות)?|נסגר(?:ה|ו)?)|(?<![\\p{L}])סגור(?:ה|ים)?\\s+(?:ל|בפני\\s+)?הגשות`, 'u'),
    new RegExp(`(?<![\\p{L}])(?:ה)?(?:הגשות|ייצוג|תערוכות|אמנים)[^.!?;\\n]{0,40}?(?:בהזמנה|בהמלצה) בלבד`, 'u'),
    // French: "nous n'acceptons pas de candidatures spontanées", "aucune candidature spontanée".
    // Job applications (emploi, stage, CV; Praktikum, Stelle) are not artists' work.
    new RegExp(`(?<![\\p{L}])n['’]\\s*(?:acceptons|accepte|acceptent|examinons|examine|étudions|étudie|prenons|recevons|traitons)\\s+(?:pas|plus|aucune?)[^.!?;\\n]{0,40}?(?:candidatures?|dossiers?|propositions?|soumissions?|portfolios?)(?![^.!?;\\n]{0,30}(?:emploi|stage|poste|recrutement|cv))`, 'iu'),
    /(?<![\p{L}])(?:pas de|aucune?) (?:candidatures?|dossiers?|propositions?) (?:spontanée?s?|d['’]artistes?)(?![^.!?;\n]{0,30}(?:emploi|stage|poste|recrutement|cv))/iu,
    // German: "wir nehmen keine Bewerbungen an", "keine unaufgeforderten Mappen", "unverlangt eingesandte … nicht".
    /(?<![\p{L}])(?:nehmen|akzeptieren|prüfen|sichten|berücksichtigen|beantworten)\s+(?:derzeit\s+|aktuell\s+|leider\s+)*(?:keine|nicht)[^.!?;\n]{0,40}?(?:bewerbungen|einsendungen|mappen|portfolios?|künstleranfragen|zusendungen)(?![^.!?;\n]{0,30}(?:praktik|stelle|job|ausbildung|mitarbeit))/iu,
    /(?<![\p{L}])keine (?:unaufgeforderten |unverlangten |neuen )?(?:bewerbungen|einsendungen|mappen|portfolios?|künstlerbewerbungen)(?![^.!?;\n]{0,30}(?:praktik|stelle|job|ausbildung|mitarbeit))/iu,
    /(?<![\p{L}])un(?:aufgefordert|verlangt) (?:eingesandte|eingereichte|zugesandte)[^.!?;\n]{0,40}?(?:nicht|keine)/iu,
    // Italian, Spanish, Portuguese: "non accettiamo candidature", "no aceptamos propuestas", "não aceitamos portfólios".
    /(?<![\p{L}])non (?:accettiamo|accetta|valutiamo|esaminiamo|riceviamo|prendiamo in considerazione)[^.!?;\n]{0,40}?(?:candidature|portfolio|proposte|invii)/iu,
    /(?<![\p{L}])no (?:aceptamos|acepta|recibimos|revisamos|evaluamos|admitimos|se aceptan|estamos aceptando)[^.!?;\n]{0,40}?(?:propuestas|portafolios?|portfolios?|dossiers?|solicitudes|candidaturas|envíos)/iu,
    /(?<![\p{L}])não (?:aceitamos|aceita|recebemos|avaliamos|estamos aceitando|estamos a aceitar)[^.!?;\n]{0,40}?(?:propostas|portf[óo]lios?|portif[óo]lios?|candidaturas|submissões|inscrições)/iu,
    // Dutch: "wij nemen geen aanmeldingen aan", "geen ongevraagde portfolio's".
    /(?<![\p{L}])(?:nemen|accepteren|behandelen|beoordelen)\s+(?:momenteel\s+|helaas\s+)*geen[^.!?;\n]{0,30}?(?:aanmeldingen|portfolio['’]?s|inzendingen|sollicitaties|voorstellen)/iu,
    /(?<![\p{L}])geen (?:ongevraagde )?(?:aanmeldingen|portfolio['’]?s|inzendingen)/iu,
    // Japanese: work brought in or portfolios are declined (持ち込みはお断り…).
    /(?:作品の)?持ち込み(?:は|を)?(?:お断り|受け付けておりません|受け付けていません)|ポートフォリオ[^。]{0,20}?(?:お断り|受け付けておりません|受け付けていません)/u,
];

/**
 * A gallery that takes artists' work: submission guidelines, an open call,
 * "Submit your work", "Artist submissions". "Submit your artwork for a free
 * auction estimate" is a consignment, not a submission.
 */
const YES_SUBMISSIONS = words([
    'submission guidelines', 'submissions? (?:policy|process|period|deadline)', 'guidelines for (?:artist )?submissions?',
    'artists?[\'’]?s? submissions?', 'how to submit', 'open calls?', 'calls? for (?:artists|entries|submissions|art)',
    'submit (?:your |an? |new )?(?:work|art|artwork|portfolio|images|proposal)(?![^.!?;\\n]{0,40}(?:auction|apprais|valuation|evaluation|estimate|consign|for sale|to sell))',
    '(?:we|the gallery) (?:accept|welcome|review|consider)s? (?:artist |new |unsolicited )?(?:submissions|portfolios)',
    '(?:now |currently )?accepting (?:artist |new )?(?:submissions|portfolios)', 'portfolio reviews?',
    // Calls for applications and sending a portfolio (not for a valuation or a sale), in French, German, Italian, Spanish, Portuguese and Dutch.
    'appels? (?:à|a) (?:candidatures?|projets|artistes)', 'candidatures? d[\'’]artistes?',
    '(?:envoy(?:ez|er)|soumettre|adresse[rz]) (?:votre|vos|un) (?:dossier|portfolio|candidature|projet|travaux)(?![^.!?;\\n]{0,40}(?:estimation|expertise|vente|enchères|vendre))',
    'künstler\\p{L}*bewerbung(?:en)?', 'bewerbung(?:en)? (?:als|von|für) künstler\\p{L}*', 'bewerbungsrichtlinien', 'einreichungsrichtlinien',
    '(?:senden|schicken) sie (?:uns )?(?:ihre|ihr|eine) (?:mappe|portfolio|bewerbung|arbeiten)(?![^.!?;\\n]{0,40}(?:schätz|bewert|einliefer|auktion|verkauf))',
    'invia(?:re)? (?:il tuo |la tua |i tuoi |un )?(?:portfolio|candidatura|progetto)(?![^.!?;\\n]{0,40}(?:valutazion|stima|vendita|asta))', 'candidature (?:per|di) artisti',
    'convocatorias?', 'env[ií]a(?:nos)? (?:tu|tus|su|sus) (?:portafolio|portfolio|propuesta|dossier)(?![^.!?;\\n]{0,40}(?:tasaci|valoraci|venta|subasta))',
    'convocat[óo]rias?', 'envie (?:seu|sua|seus) (?:portf[óo]lio|proposta)(?![^.!?;\\n]{0,40}(?:avalia|venda|leil))', 'inscri[cç](?:ões|oes|ão|ao) (?:para|de) artistas',
    'open oproep', 'aanmelden als kunstenaar', 'kunstenaars? (?:kunnen zich )?aanmelden', 'stuur (?:je|uw) portfolio',
], WHOLE, {
    // Submitting work or a portfolio (not "for sale" or for a valuation), an
    // open call (קול קורא), "artists are invited to submit", the guidelines.
    he: ['הגשת (?:עבודות|תיק(?:י)? (?:ה)?עבודות|יצירות|מועמדות (?:של |ל)?אמנים)(?![^.!?;\\n]{0,30}(?:מכיר|הערכ|שמאות))', 'קול(?:ות)? קור(?:א|אים)',
        '(?:אמנים|אמניות|אמנים ואמניות) מוזמנ(?:ים|ות) להגיש', 'מוזמנ(?:ים|ות) להגיש (?:עבודות|תיק|תיקי|יצירות|הצעות)',
        'שלחו (?:לנו )?(?:את )?(?:תיק(?:י)? (?:ה)?עבודות|עבודות|יצירות)(?![^.!?;\\n]{0,30}(?:מכיר|הערכ|שמאות))', 'הנחיות (?:ל)?הגשה', 'קבלת (?:תיקי עבודות|הגשות)'],
    // Calls for works and artists (作品募集, 公募, 作家募集; 작가 공모; 徵集).
    cjk: ['作品募集', '公募', '作家募集', 'アーティスト募集', '작가 ?공모', '작품 ?공모', '공모전', '포트폴리오 ?접수', '藝術家徵集', '艺术家征集'],
});

/**
 * Consigning or selling to them: "consign", "sell your art", "selling with
 * us", "we buy…", appraisals for a sale, valuation and estimate requests.
 */
const CONSIGN = words([
    'consign\\w*', 'sell (?:your |my |their )?(?:art|artwork|artworks|paintings?|collection|works?|prints|sculpture|property|items?)',
    'sell(?:ing)? (?:with|through) us', 'selling your (?:art|artwork|paintings?|collection|works?)', 'how to sell',
    'we(?:[\'’]re| are)? (?:always |actively |currently )?(?:buy|buying|purchas\\w*|acquir\\w*)(?: and sell(?:ing)?)?[^.!?;\\n]{0,30}?(?:art|artworks?|paintings?|collections?|estates?|prints|sculptures?|photographs|works)',
    'apprais\\w*[^.!?;\\n]{0,40}?(?:sale|selling|sell|auction|consign\\w*)', '(?:auction|sale|selling) (?:estimates?|apprais\\w*|valuations?)',
    'valuation (?:requests?|forms?|days?|services?)', 'request (?:a |an |your )?(?:free )?(?:auction )?(?:estimate|valuation|appraisal|evaluation)s?',
    '(?:free|complimentary) (?:auction )?(?:estimates?|valuations?|apprais\\w*|evaluations?)',
    // Selling through them, free valuations and estimates, consigning to an auction (Einlieferung, inbreng, indlevering), "we buy…".
    'vendre avec nous', 'vendre (?:votre |vos |une |un |des )?(?:œuvres?|oeuvres?|tableaux?|collection|objets? d[\'’]art)', 'comment vendre', 'estimations? (?:gratuites?|offertes?|en ligne)', 'demande d[\'’]estimation',
    'expertises? gratuites?', 'inventaires? et estimations?', 'dépôt[- ]vente', 'nous achetons[^.!?;\\n]{0,30}?(?:œuvres?|oeuvres?|tableaux|art|collections?|successions?)',
    'einliefer\\p{L}*', 'verkaufen sie (?:ihre|ihr|ihren)', 'kostenlose (?:schätzung|bewertung|expertise)', 'schätzung anfragen', 'schätzungsanfrage', 'schätztag\\p{L}*', 'bewertungsanfrage',
    'kunstankauf', '(?:an- und verkauf|ankauf) von (?:kunst|gemälden|bildern|grafik|sammlungen|nachlässen)', 'wir kaufen[^.!?;\\n]{0,30}?(?:kunst|gemälde|bilder|sammlungen|nachlässe|grafik)',
    'vendere (?:la tua|le tue|un|una|i tuoi) (?:opera|opere|collezione|dipint\\p{L}+|quadr\\p{L}+)', 'vendi (?:con noi|le tue opere|la tua)', 'valutazion[ei] (?:gratuit[ae]|online)',
    'richied(?:i|ere) (?:una )?valutazione', 'stime gratuite', 'conferimento (?:di |delle |dei )?(?:opere|beni|lotti)', 'mandato a vendere', 'acquistiamo[^.!?;\\n]{0,30}?(?:opere|dipinti|quadri|collezioni)',
    'vender (?:su|sus|tu|tus|una|un|sua|suas|seu|seus|uma|um) (?:obras?|colecci[oó]n|cole[cç][aã]o|cuadros?|quadros?|pinturas?)', 'vende (?:con nosotros|tu obra|tus obras)',
    'venda (?:conosco|connosco|sua obra|suas obras)', 'tasaci(?:ón|on|ones) gratuitas?', 'valoraci(?:ón|on|ones) gratuitas?', 'solicit(?:e|a|ar) (?:una )?(?:tasaci[oó]n|valoraci[oó]n)',
    'avalia(?:ção|cao|ções|coes) gratuitas?', 'solicite (?:uma )?avalia(?:ção|cao)', 'compramos[^.!?;\\n]{0,30}?(?:obras?|arte|cuadros|quadros|pinturas|colecciones|cole[cç][õo]es)',
    'verkopen via (?:ons|onze veiling)', 'inbreng\\p{L}*[^.!?;\\n]{0,40}?veiling', 'gratis taxatie', 'taxatiedag\\p{L}*', 'taxatie aanvragen', 'wij kopen[^.!?;\\n]{0,30}?(?:kunst|schilderijen|collecties)',
    'gratis (?:värdering|vurdering)', 'värderingsdag\\p{L}*', 'indlever\\p{L}*', 'innlever\\p{L}*', 'lämna in[^.!?;\\n]{0,30}?(?:auktion|försäljning)',
], WHOLE, {
    // Handing work over for sale (מסירה למכירה), accepting works for sale,
    // buying and selling art, "we buy…", appraisal (שמאות) and valuation
    // (הערכת שווי), "sell your work through us".
    he: ['מסירה למכירה', 'מסיר(?:ה|ת) (?:עבודות|יצירות|פריטים|אוספים|אוסף) (?:ל)?מכיר', '(?:קבלת|מקבל(?:ים|ת)) (?:עבודות|יצירות|פריטים) (?:ל)?מכיר',
        '(?:קנייה|קניה) ומכירה של (?:אמנות|אומנות|יצירות|ציורים)', '(?:אנו|אנחנו) קונים[^.!?;\\n]{0,30}?(?:אמנות|אומנות|יצירות|ציורים|אוספים|עזבונות|פריטים)',
        'שמאות', 'שמאי' + HE_END, 'הערכ(?:ת|ות) שווי', 'למכור (?:את )?(?:ה)?(?:יצירה|יצירות|ציור|ציורים|אוסף|עבודות)[^.!?;\\n]{0,20}?(?:שלכם|שלך|דרכנו|אצלנו|איתנו)'],
    // Buying (買取, 매입), appraisal (査定), consignment (委託, 위탁; 委托), consigning to an auction (出品のご案内, 徵集拍品). "出品作家" are the artists in a show.
    // 委託 / 위탁 alone is also the outsourcing line of every privacy notice.
    cjk: ['買取', '買い取り', '無料査定', '査定', '委託(?:販売|出品|品)', '出品(?:のご案内|をご希望|方法|について|受付|申込)', '위탁 ?(?:판매|출품|경매)', '작품 ?매입', '출품 ?문의',
        '委託(?:拍賣|出售)', '委托(?:拍卖|出售)', '估價', '估价', '徵集拍品', '征集拍品', '收購藝術品', '收购艺术品'],
});
/** "We are not accepting consignments at this time." */
const NO_CONSIGN = [
    new RegExp(`(?<![\\p{L}])${NEG}${ADVERBS}\\s+(?:accept|tak(?:e|es|ing)|offer|handl)\\w*(?:\\s+(?:any|new|outside|work|works|art|on))*\\s+consign`, 'iu'),
    /\bno consignments\b/i,
    // "איננו מקבלים עבודות למכירה", "אין קבלת יצירות למכירה".
    new RegExp(`(?<![\\p{L}])(?:אין|איננו|אנו לא|אנחנו לא|לא)\\s+(?:מקבל(?:ים|ת)?|קונים|קבלת)[^.!?;\\n]{0,20}?(?:עבודות|יצירות|פריטים)\\s+(?:ל|ב)?מכיר`, 'u'),
    // "Nous n'acceptons pas de dépôts", "keine Einlieferungen", "no aceptamos consignaciones", "não aceitamos consignações".
    /(?<![\p{L}])n['’]\s*(?:acceptons|accepte|prenons)\s+(?:pas|plus)\s+(?:de\s+)?(?:dépôts?|consignations?|dépôts?-ventes?)/iu,
    /(?<![\p{L}])(?:keine|nehmen (?:derzeit |aktuell )?keine) (?:einlieferungen|kommissionsware)/iu,
    /(?<![\p{L}])no (?:aceptamos|acepta|admitimos) (?:obras en )?consignaci(?:ón|on|ones)/iu,
    /(?<![\p{L}])não (?:aceitamos|aceita) (?:obras em )?consigna[cç](?:ão|ao|ões|oes)/iu,
];

/**
 * Other languages' words for the link patterns. Hebrew: הגשת עבודות, קול
 * קורא; מסירה למכירה, שמאות, הערכת שווי, אנו קונים. French, German,
 * Italian, Spanish, Portuguese, Dutch: appel à candidatures,
 * Künstlerbewerbung / Einreichung, candidature artisti, convocatoria /
 * convocatória, open oproep; vendre, Einlieferung, verkaufen, Schätzung,
 * valutazione, tasación, avaliação, taxatie, inbreng, värdering. Japanese,
 * Korean, Chinese: 作品募集 / 公募, 공모, 徵集; 買取, 査定, 委託, 위탁, 估價.
 * Job applications ("Bewerbung", "candidature spontanée") are not artist
 * submissions, and "Verkauf" / "vendita" / "venta" (for sale) is not
 * consigning.
 */
const SUBMISSION_LINK_WORDS = ['הגשת[-_ ](?:עבודות|תיק|יצירות)', 'הגשות', 'קול[-_ ]קורא', 'קולות[-_ ]קוראים',
    'appel[-_ ]?(?:à|a)[-_ ]?(?:candidatures?|projets|artistes)', 'candidatures?[-_ ](?:d[-_\'’ ]?)?artistes?', 'dossiers?[-_ ]d[-_\'’ ]?artistes?',
    'künstler\\p{L}*[-_ ]?bewerbung', 'bewerbung(?:en)?[-_ ](?:für|von|als)[-_ ]künstler', 'einreichung(?:en)?',
    'candidature[-_ ](?:artisti|per[-_ ]artisti)', 'convocatorias?', 'convocat[óo]rias?', 'open[-_ ]oproep', 'aanmelden[-_ ](?:als[-_ ])?kunstenaar',
    '作品募集', '公募', '作家募集', '공모', '徵集', '征集'];
const NOT_SUBMISSION_LINK_WORDS = ['מכיר', 'שמאות', 'הערכ', 'einliefer', 'schätz', 'estimation', 'vendre', 'valutazion', 'stima', 'tasaci', 'avalia', 'taxatie', 'inbreng',
    'v[äa]rdering', 'vurdering', 'auktion', 'ench[èe]res', 'subasta', 'leil', 'veiling', '買取', '査定', '委託', '위탁', '估價', '估价', '拍賣', '拍卖'];
const CONSIGN_LINK_WORDS = ['מסירה', 'מסירת', 'שמאות', 'שמאי', 'הערכת[-_ ]שווי', '(?:אנו|אנחנו)[-_ ]קונים', 'קונים[-_ ](?:אמנות|יצירות|ציורים)',
    'vendre', 'estimations?', 'd[ée]p[ôo]t[-_ ]vente', 'einliefer', 'verkaufen', 'schätz', 'ankauf', 'vendere', 'vendi[-_ ]con[-_ ]noi', 'valutazion', 'stime',
    'tasaci', 'vender', 'avalia', 'verkopen', 'taxatie', 'inbreng', 'v[äa]rdering', 'vurdering', 'innlever', 'indlever',
    '買取', '査定', '委託(?:販売|出品)', '出品(?!作家|作品|リスト)', '위탁 ?(?:판매|출품|경매)', '매입', '估價', '估价', '委託拍賣', '委托拍卖', '徵集拍品', '征集拍品'];
/**
 * Links to the pages these fields point at: an address or link text that
 * says submission(s) / open call / submit your work, and one that says
 * consign / sell with us / we buy / valuation / appraisal. A "Consignment
 * submissions" link is a consignment page. Exported for the contact lookup,
 * which reads one page of each (the art campaign's followLinks).
 */
export const SUBMISSION_LINK = new RegExp(`^(?!.*(?:consign|auction|apprais|valuation|estimate|\\bsell|${NOT_SUBMISSION_LINK_WORDS.join('|')})).*?(?:submissions?|open[-_ ]?calls?\\b|call[-_ ]for[-_ ](?:artists|entries|submissions|art)\\b|submit[-_ ](?:your[-_ ])?(?:work|art|artwork|portfolio)\\b|${SUBMISSION_LINK_WORDS.join('|')})`, 'iu');
export const CONSIGN_LINK = new RegExp(`consign|(?:^|[/\\s])sell(?:ing)?(?:[-_ ](?:with[-_ ]?us|through[-_ ]us|your|art|artwork)|[/\\s]|$)|how[-_ ]to[-_ ]sell|we[-_ ]buy|valuations?|apprais|(?:auction|free)[-_ ]estimates?|request[-_ ](?:an?[-_ ])?(?:estimate|valuation|appraisal)|${CONSIGN_LINK_WORDS.join('|')}`, 'iu');
export const ART_LINKS = [SUBMISSION_LINK, CONSIGN_LINK];

/** What a link pattern is tested against: the address (path and query) and its text. */
function linkHay(link) {
    let where = '';
    try {
        const u = new URL(link.url);
        try { where = decodeURIComponent(u.pathname + u.search); } catch { where = u.pathname + u.search; }
    } catch { /* not a URL */ }
    return `${where} ${clean(link.text)}`.trim();
}

/**
 * The best link for a field: a stronger kind first (`ranks`), then one whose
 * address says so over one whose text alone does, then page order.
 */
function pickLink(links, re, ranks = []) {
    let best = null;
    for (const link of links || []) {
        if (!link || !link.url) continue;
        const hay = linkHay(link);
        if (!re.test(hay)) continue;
        const kind = ranks.findIndex(r => r.test(hay));
        const inText = re.test(linkHay({ url: link.url, text: '' })) ? 0 : 1;
        const rank = (kind === -1 ? ranks.length : kind) * 2 + inText;
        if (!best || rank < best.rank) best = { url: link.url, rank };
    }
    return best ? best.url : '';
}

// ─── Specialties ──────────────────────────────────────────────────────────

/** One pattern from several: `a|b`, global and Unicode. */
const either = (...res) => new RegExp(res.map(r => r.source).join('|'), 'giu');
/** Hebrew "art" with its prefix-free forms, for the specialty phrases: אמנות / אומנות. */
const HE_ART = '(?:אמנות|אומנות)';

/**
 * The fixed vocabulary of `specialties`, in the order they are listed. Each
 * entry counts only when the listing or the site names it. Single words that
 * mean many things ("modern", "contemporary", "design", "glass") need an art
 * word next to them: "contemporary framing", "modern furniture" and "glass
 * doors" are not specialties. The values are English whatever the site's
 * language ("אמנות עכשווית" is contemporary). The list is Varnish AI's own
 * (lib/leads/labels.ts there, same order), which ends with israeli art and
 * judaica.
 */
/** A photo credit is not a specialty: "Photographie : X", "Fotografie von X", "Foto: X". */
const NO_CREDIT = '(?![\\p{L}\\p{N}])(?!\\s*(?:[:：©]|(?:par|de|von|di|da|por|door|av|by)\\s))';

export const SPECIALTIES = [
    ['contemporary', words(['contemporary (?:art|arts|artists?|paintings?|works?|photography|sculpture|ceramics|craft|fine art|realism|prints?|abstract\\w*|african|asian|latin|native|american|chinese|indian|israeli|glass|gallery|masters?|works on paper)', '(?:modern|post-?war) (?:and|&) contemporary',
        'art contemporain', 'artistes contemporains', 'création contemporaine', 'zeitgenössische (?:kunst|künstler\\p{L}*|malerei|fotografie|positionen)', 'gegenwartskunst',
        'arte contemporanea', 'artisti contemporanei', 'arte contempor[áa]neo', 'artistas contempor[áa]neos', 'arte contempor[âa]nea', 'hedendaagse kunst', 'eigentijdse kunst', 'samtidskonst', 'samtidskunst', 'nutidskunst'], WHOLE, {
        he: [`${HE_ART} (?:ה)?(?:ישראלית )?(?:ה)?עכשווית`, `${HE_ART} בת זמננו`, 'אמנ(?:ים|יות) עכשווי(?:ים|ות)', '(?:ציור|צילום|פיסול|יצירה) עכשווי(?:ת)?' + HE_END],
        cjk: ['現代美術', '現代アート', 'コンテンポラリー', '현대 ?미술', '동시대 ?미술', '컨템포러리', '當代藝術', '当代艺术'],
    })],
    ['modern', words(['modern (?:art|arts|masters?|paintings?|works?|prints?|sculpture|american|british|european|and contemporary|& contemporary)', 'modernis[mt]s?',
        'art moderne', 'maîtres modernes', 'moderne kunst', 'klassische moderne', 'kunst der moderne', 'arte moderna', 'arte moderno', 'modern konst', 'modernisme', 'modernismo', 'modernismus'], WHOLE, {
        he: [`${HE_ART} (?:ה)?מודרנית`, 'מודרניז', 'מודרניסט'],
        cjk: ['近代美術', '近代絵画', '근대 ?미술', '現代藝術', '现代艺术', '近代藝術'],
    })],
    ['post-war', words(['post-?war', 'postwar', 'nachkriegs\\p{L}*', 'après-guerre', 'dopoguerra', 'posguerra', 'pós-guerra', 'naoorlogse'], WHOLE, {
        he: [`${HE_ART} שלאחר המלחמה`], cjk: ['戦後美術', '전후 ?미술'],
    })],
    ['impressionist', words(['(?:post-)?impressionis[mt]s?', 'impressionismus', 'impressionisten', 'impressionnis(?:me|tes?)', 'impresionis(?:mo|tas?)', 'impressionis(?:mo|ti|ta|tas|me|ten)'], WHOLE, {
        he: ['אימפרסיוניז', 'אימפרסיוניסט'], cjk: ['印象派', '인상파', '인상주의'],
    })],
    ['old masters', words(['old masters?', 'alte meister', 'maîtres anciens', 'tableaux anciens', 'antichi maestri', 'maestri antichi', 'maestros antiguos', 'mestres antigos', 'oude meesters', 'äldre mästare', 'gamle mestre'], WHOLE, {
        he: ['מאסטרים (?:ה)?ותיקים'],
    })],
    ['american art', words(['(?<!(?:native|latin|african|north|south|central|asian|mexican|indian|pan)[- ])american (?:art|paintings?|artists?|masters?|modernism|impressionis[mt]s?|realism|regionalism|illustration)', 'hudson river school'])],
    ['african american art', words(['african[- ]american (?:art|artists?|masters?|fine art)', 'black artists'])],
    ['latin american', words(['latin[- ]american', 'latin(?:o|x|e) (?:art|artists?)', 'arte latinoamericano', 'latinoamerican[oa]s?', 'arte latino-americana', 'latino-american[oa]s?', 'art latino-américain'])],
    ['asian art', words(['asian (?:art|antiques?|artists?|contemporary|works of art)', '(?:chinese|japanese|korean|southeast asian|himalayan|tibetan) (?:art|paintings?|ceramics|porcelain|antiques?|prints|works of art|scrolls?|woodblocks?)', 'ukiyo-?e',
        'art asiatique', 'arts? d[\'’]asie', 'asiatische kunst', 'arte asiatica', 'arte asi[áa]tic[oa]', 'aziatische kunst', 'asiatisk konst', 'art (?:chinois|japonais|coréen)', '(?:chinesische|japanische|koreanische) kunst'], WHOLE, {
        he: [`${HE_ART} (?:ה)?(?:אסייתית|יפנית|סינית|הודית)`],
        // Oriental and antique art, Nihonga, Chinese painting and calligraphy, ink, Korean painting.
        cjk: ['東洋美術', '古美術', '日本画', '中国美術', '中國書畫', '中国书画', '書畫', '书画', '水墨', '동양화', '한국화', '고미술'],
    })],
    ['african art', words(['african (?:art|arts|artists?|sculpture|masks?|textiles?|contemporary art|tribal art)', 'tribal art',
        'art africain', 'arts premiers', 'afrikanische kunst', 'stammeskunst', 'arte africana', 'arte africano', 'afrikaanse kunst', 'tribale kunst'], WHOLE, { he: [`${HE_ART} (?:ה)?אפריקאית`] })],
    // In Australia and New Zealand, "Indigenous art" is Aboriginal or Māori art, not Native American.
    ['native american', words(['native american (?:art|artists?|pottery|jewelry|rugs?|baskets?|weavings?|textiles?|antiques?|beadwork|paintings?)', '(?:pueblo|navajo|hopi|zuni|apache) (?:pottery|rugs?|textiles?|weavings?|jewelry|baskets?|art)', 'kachinas?', 'indigenous (?:art|artists?)', 'american indian art']),
        { unless: /aboriginal|torres strait|papunya|arnhem land|m[āa]ori/i }],
    // "Asian and Western art" in Hong Kong or Tokyo is European art, not the American West.
    ['western art', words(['western (?:art|american art|paintings?|bronzes?|artists?|landscapes?)', 'art of the (?:american )?west', 'cowboy art']),
        { unless: /\b(?:asian|chinese|japanese|korean|eastern|oriental) (?:and|&) western\b|\bwestern (?:and|&) (?:asian|chinese|japanese|korean|eastern|oriental)\b|\beast(?:ern)? (?:and|&|meets) west\b/i }],
    ['outsider art', words(['outsider art', 'self-taught (?:art|artists?)', 'art brut', 'visionary art', 'außenseiterkunst', 'arte marginal'], WHOLE, {
        he: ['(?:אמנות|אומנות) (?:ה)?אאוטסיידר'], cjk: ['アール・?ブリュット', 'アウトサイダー・?アート'],
    })],
    ['folk art', words(['folk art', 'art populaire', 'volkskunst', 'arte popolare', 'arte popular', 'folkkonst', 'folkekunst'], WHOLE, {
        he: [`${HE_ART} (?:ה)?עממית`], cjk: ['民藝', '民芸', '민화', '民間藝術', '民间艺术'],
    })],
    ['photography', either(
        new RegExp(`(?<![\\p{L}\\p{N}])(?<!installation |installation view |exhibition |website |site |images? |photos? )(?:fine art |contemporary |vintage |documentary )?photograph(?:y|s|ic)(?![\\p{L}\\p{N}])(?!\\s*(?:by|credits?|:|©))`, 'giu'),
        words([`photographies?${NO_CREDIT}`, `fotografi(?:e|a|en)?${NO_CREDIT}`, `fotografía${NO_CREDIT}`], WHOLE, {
            // "צילום: יוסי" and "צילום יוסי לוי" are credits: photography counts
            // as art photography, next to other media, or as the art of photography.
            he: ['צילום (?:אמנותי|עכשווי|ישראלי|דוקומנטרי|אמנות)', 'צילומי (?:אמנות|אמן)', `${HE_ART} (?:ה)?צילום`, 'גלרי(?:ה|ית) (?:ל)?צילום',
                'צילום(?=[^.!?;:\\n]{0,20}(?:ציור|פיסול|רישום|הדפס|וידאו|מיצב))', '(?:ציור|פיסול|רישום|הדפס|וידאו|מיצב)[^.!?;:\\n]{0,20}צילום'],
            // 写真 alone is any photo on the page: photo works, exhibitions, art.
            cjk: ['写真(?:作品|展|芸術|ギャラリー)', 'フォトグラフィー', '사진 ?(?:작품|전|예술)', '攝影(?:作品|展|藝術)', '摄影(?:作品|展|艺术)'],
        }),
    )],
    ['prints', words(['(?:fine art )?prints', 'printmak\\w*', 'lithograph\\w*', 'etchings?', 'screen ?prints?', 'serigraphs?', 'woodcuts?', 'editions and multiples', 'multiples',
        'estampes?', 'gravures?', 'lithographies?', 'sérigraphies?', 'druckgra(?:f|ph)ik', 'grafik', 'radierung(?:en)?', 'lithografien?', 'holzschnitte?', 'siebdrucke?',
        'stampe', 'incisioni', 'grafica d[\'’]arte', 'litografi[ae]', 'serigrafi[ae]', 'acqueforti', 'acquaforte', 'grabados?', 'obra gráfica', 'litograf[ií]as?', 'serigraf[ií]as?',
        'gravuras?', 'grafiek', 'prenten', 'etsen'], WHOLE, {
        // הדפס / הדפסים, not הדפסה (printing).
        he: ['הדפס(?:ים|י)?' + HE_END, 'תחריט', 'ליתוגרפי', 'סריגרפי', 'חיתוכי עץ'],
        cjk: ['版画', '版畫', 'リトグラフ', 'シルクスクリーン', '판화'],
    })],
    ['sculpture', words(['sculptur(?:e|es|al)', 'sculptors?', 'bronzes', 'sculpteurs?', 'skulptur(?:en|er)?', 'bildhauer\\p{L}*', 'scultur[ae]', 'scultor[ei]', 'escultur(?:a|as|al)', 'escultor(?:es|a|as)?', 'beeldhouw\\p{L}*'], WHOLE, {
        he: ['פיסול', 'פס(?:ל|לים|לת|לות)' + HE_END], cjk: ['彫刻', '조각', '조소', '雕塑'],
    })],
    ['works on paper', words(['works? on paper', '(?:œuvres|oeuvres) sur papier', '(?:arbeiten|werke) auf papier', 'opere su carta', 'obras? sobre papel', 'werken op papier', 'verk på papper'], WHOLE, {
        he: ['עבודות (?:על )?נייר'], cjk: ['紙作品', '紙の作品', '종이 ?작품'],
    })],
    ['ceramics', words(['ceramics?', '(?:studio |art )?pottery', 'porcelain', 'céramiques?', 'keramik(?:en)?', 'porzellan', 'ceramic(?:a|he)', 'porcellan[ae]', 'cer[áa]micas?', 'cerâmicas?', 'porcelana', 'keramiek'], WHOLE, {
        he: ['קרמיקה', 'קדרות'], cjk: ['陶芸', '陶磁', '陶器', '도자', '도예', '陶瓷'],
    })],
    ['glass', words(['(?:studio|art|contemporary|blown|fused|sculptural|venetian|murano) glass', 'glass (?:art|sculptures?|artists?)',
        'verre d[\'’]art', 'art du verre', 'verrerie d[\'’]art', 'sculptures? en verre', 'glaskunst', 'studioglas', 'vetr[oi] d[\'’]arte', 'vetro di murano', 'arte en vidrio', 'vidrio artístico', 'arte em vidro', 'glaskonst', 'konstglas'], WHOLE, {
        he: [`${HE_ART} (?:ה)?זכוכית`, 'זכוכית אמנותית', 'פיסול (?:ב)?זכוכית', 'ניפוח זכוכית'],
        cjk: ['ガラス工芸', 'ガラスアート', '유리 ?공예', '玻璃藝術', '玻璃艺术'],
    })],
    ['design', words(['(?:collectible|collectable|20th[- ]century|mid-century|midcentury|modernist|scandinavian|italian|french|historic|contemporary) design', 'design (?:objects|gallery)', 'mid-?century modern',
        'design de collection', 'design historique', 'design da collezione', 'design storico', 'mobilier (?:moderniste|du xxe)', 'designklassiker'])],
    ['decorative arts', words(['decorative arts?', 'objets? d[\'’]art', 'fine (?:and|&) decorative',
        'arts décoratifs', 'kunsthandwerk', 'angewandte kunst', 'arti decorative', 'artes decorativas', 'toegepaste kunst', 'kunstnijverheid', 'konsthantverk', 'kunsthåndværk'], WHOLE, {
        he: [`${HE_ART} שימושית`, '(?:אמנויות|אומנויות) שימושיות'], cjk: ['工芸', '공예', '工藝', '工艺'],
    })],
    ['emerging artists', words(['emerging (?:and (?:established|mid-career) )?(?:artists?|talent|art)',
        'jeunes artistes', 'artistes émergents', 'junge (?:kunst|künstler\\p{L}*)', 'nachwuchskünstler\\p{L}*', 'artisti emergenti', 'giovani artisti', 'artistas emergentes',
        'jóvenes artistas', 'jovens artistas', 'jonge kunstenaars', 'opkomende kunstenaars', 'unga konstnärer', 'unge kunstnere'], WHOLE, {
        he: ['אמנ(?:ים|יות) צעיר(?:ים|ות)', 'אמנ(?:ים|יות) מתחיל(?:ים|ות)', 'אמנ(?:ים|יות) בתחילת דרכ'],
        cjk: ['若手作家', '新進作家', '若手アーティスト', '신진 ?작가', '젊은 ?작가', '新晉藝術家', '新锐艺术家', '年輕藝術家', '年轻艺术家'],
    })],
    ['israeli art', words(['israeli (?:art|artists?|painters?|painting|photograph\\w*|sculpt\\w*|contemporary art|modern art)', 'art (?:of|from) israel', '(?:contemporary|modern) israeli',
        'israelische kunst', 'art israélien', 'arte israel[ií]', 'arte israeliana'], WHOLE, {
        he: [`${HE_ART} (?:ה)?ישראלית`, 'אמנ(?:ים|יות) (?:ה)?ישראלי(?:ים|ות)', '(?:ציור|צילום|פיסול) (?:ה)?ישראלי' + HE_END, 'ציירים ישראלים'],
    })],
    ['judaica', words(['judaica', 'judaika', 'judaïca', 'jewish ceremonial art', 'jewish ritual (?:art|objects)'], WHOLE, { he: ['יודאיקה', 'יודאיקא', 'תשמישי קדושה'] })],
];

/**
 * Museum names say nothing about the gallery: "near the Asian Art Museum",
 * "the Museum of Modern Art", "the Institute of Contemporary Art". They are
 * capitalised, which keeps "contemporary art and the museum shop" intact.
 * Hebrew has no capitals: "מוזיאון" and the words after it, up to four
 * ("מוזיאון הרצליה לאמנות עכשווית").
 */
const MUSEUM_NAMES = /(?<![\p{L}])(?:(?:\p{Lu}[\p{L}'’.-]*\s+){0,3}Museum(?:\s+of(?:\s+the)?(?:\s+\p{Lu}[\p{L}'’.-]*){1,4})?|(?:Institute|Cent(?:er|re))\s+(?:of|for)\s+(?:\p{Lu}[\p{L}'’.-]*\s+){0,3}Arts?)(?![\p{L}])/gu;
const MUSEUM_NAMES_HE = /(?<![\p{L}])[והבכלש]{0,2}(?:מוזיאון|מוזאון|משכן לאמנות)(?:\s+[^\s,.;:!?()"״]+){0,4}/gu;
/**
 * …and in the other languages, read before the English pattern: "Musée
 * d'Art Moderne de Paris", "Museo de Arte Contemporáneo", "Museum für
 * Moderne Kunst", "Moderna Museet", "Fondation Cartier pour l'Art
 * Contemporain"; 東京都現代美術館, 국립현대미술관, 台北當代藝術館 (the whole run of
 * characters before 美術館 / 미술관 / 藝術館).
 */
const MUSEUM_NAMES_OTHER = /(?<![\p{L}])(?:Musée|Museo|Museu|Muzeum|Kunstmuseum|Kunsthalle|Konsthall|Fondation|Fundación|Fondazione|Fundação|Stiftung|Museum(?=\s+(?:für|voor|van|de|di|del|der)\s))(?:\s+(?:(?:d['’]|de|del|della|delle|des|du|der|für|voor|van|di|do|da|dos|das|pour|per|para|la|le|les|l['’])\s*)*\p{Lu}[\p{L}'’.-]*){1,5}|(?<![\p{L}])(?:\p{Lu}[\p{L}'’.-]*\s+){1,3}(?:Museet|Kunsthalle|Konsthall)(?![\p{L}])|[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}ー・]*(?:美術館|美术馆|博物館|博物馆|藝術館|艺术馆)|\p{Script=Hangul}*(?:미술관|박물관)/gu;

// ─── Scoring ──────────────────────────────────────────────────────────────

/**
 * Score one place for the art campaign. `sellable` is isSellable(lead) from
 * relevance.js (museums, art centers and public bodies stay out here too);
 * `links` are the links the contact lookup found (lead._siteLinks).
 * @returns {{ score:number, tier:string, evidence:string, provisional:boolean, fields:object }}
 *   provisional: "Not a buyer" from the listing alone, which the website can
 *   still overturn ("X Gallery & Framing" showing exhibitions), so the feed
 *   keeps the place for its website to be read.
 */
export function scoreArt(lead, siteText = '', sellable = { ok: true }, links = []) {
    const name = clean(museumWordsOut(lead.business_name));
    const category = clean(lead.category);
    const description = clean(lead.maps_description);
    const site = clean(siteText).slice(0, 200000);
    const listing = [name, category, description].join(' · ');
    const all = `${listing} · ${site}`;

    const art = has(ART_WORD, listing);
    // What the listing says the place is: an auction house in the name or
    // category is one; otherwise the name (the business's own word), then
    // Maps' category, then its description.
    const auctionListed = has(AUCTION, name) || has(AUCTION, category);
    const nameType = typeIn(name, { name: true, art });
    const categoryType = typeIn(category);
    const descriptionType = typeIn(description);
    const listingType = auctionListed ? 'auction_house' : (nameType || categoryType || descriptionType);

    const galleryOnSite = has(EXHIBITIONS, site) || has(REPRESENTED, site);
    const claimsGallery = has(GALLERY, name) || has(GALLERY, category);
    const frame = has(FRAME, name) || has(FRAME, category);
    const artist = has(ARTIST_CATEGORY, category) || (has(ARTIST_NAME, name) && !has(BUYER_NAME, name));
    const gift = has(GIFT_CATEGORY, category) && !has(NOT_BUYER_CATEGORY, category);
    const hard = [...find(NOT_BUYER_CATEGORY, category).words, ...find(NOT_BUYER_NAME, name).words, ...find(NOT_BUYER_DESCRIPTION, description).words];
    // Nothing to do with art: a "Car dealer" called Galleria Motors. (Frame,
    // artist and gift categories are judged above, where the site can still
    // make them a gallery.)
    const unrelated = !!category && !has(ART_CATEGORY, category) && !GENERIC_CATEGORY.test(category)
        && !has(FRAME, category) && !has(ARTIST_CATEGORY, category) && !has(GIFT_CATEGORY, category);

    // isSellable's own rules also drop schools and academies by name ("Young
    // Rembrandts Art School"); a commercial art school is not a non-profit,
    // it is not a buyer. Museums, art centers and universities are.
    const nonProfit = !!artNonProfit(lead) || has(NONPROFIT_SITE, site) || (!sellable.ok && !hard.length);

    const why = [];
    let tier;
    let type = '';
    let provisional = false;
    if (nonProfit) {
        tier = 'Non-profit / museum';
        why.push(...find(NONPROFIT_ART, `${name} · ${category}`).words, ...find(NONPROFIT_SITE, site).words.map(w => `${w} (site)`));
    } else if (hard.length) {
        // Supplies, classes, tattoo, printing, photographers, interiors, cafés…
        tier = 'Not a buyer';
        why.push(...hard);
    } else if (frame && !galleryOnSite) {
        // Framing beats "gallery": many Maps "art galleries" are frame shops.
        // Only exhibitions or represented artists on the site make it one.
        tier = 'Not a buyer';
        provisional = claimsGallery || has(FINE_ART, name);
        why.push(...find(FRAME, `${name} · ${category}`).words);
    } else if (artist && !has(REPRESENTED, site)) {
        // An artist's studio sells its own work. A CV lists "Exhibitions", so
        // only artists it represents make it a gallery.
        tier = 'Not a buyer';
        provisional = claimsGallery;
        why.push(...find(ARTIST_CATEGORY, category).words, ...find(ARTIST_NAME, name).words);
    } else if (gift && !galleryOnSite) {
        tier = 'Not a buyer';
        provisional = claimsGallery || has(FINE_ART, name);
        why.push(...find(GIFT_CATEGORY, category).words);
    } else if (unrelated) {
        tier = 'Not a buyer';
        why.push(category.toLowerCase());
    } else {
        type = listingType;
        if (has(ANTIQUE, category) && type !== 'auction_house') {
            // An antique shop is an art dealer only when it deals in art.
            type = (has(ART_WORD, `${name} · ${description}`) || has(DEALER, site)) ? 'dealer' : '';
            if (type) why.push(...find(ANTIQUE, category).words, ...find(ART_WORD, `${name} · ${description}`).words);
        } else if (has(APPRAISER, category) && !nameType) {
            // An appraiser values art; it buys or sells only if it says so.
            const said = siteType(site);
            type = said === 'gallery' ? '' : said;
        } else {
            // "Smith Fine Art" filed under nothing useful: the site decides,
            // and an art name alone makes it a gallery.
            type = type || siteType(site) || (has(ART_WORD, name) ? 'gallery' : '');
        }
        tier = type ? TIER_OF[type] : 'Not a buyer';
        if (!type) why.push('no art buyer words');
    }

    // ─── The contract fields ───
    const noSubmissions = NO_SUBMISSIONS.some(re => re.test(all));
    const submissionUrl = pickLink(links, SUBMISSION_LINK, [/submissions?|open[-_ ]?call|call[-_ ]for/i]);
    const accepts_submissions = noSubmissions ? 'no' : (has(YES_SUBMISSIONS, all) || submissionUrl) ? 'yes' : 'unknown';
    const consignUrl = pickLink(links, CONSIGN_LINK, [/consign/i, /sell/i, /we[-_ ]buy/i]);
    const consigned = !NO_CONSIGN.some(re => re.test(all)) && (has(CONSIGN, all) || !!consignUrl);
    const specialtyText = all.replace(MUSEUM_NAMES_OTHER, ' ').replace(MUSEUM_NAMES, ' ').replace(MUSEUM_NAMES_HE, ' ');
    const specialties = SPECIALTIES.filter(([, re, only = {}]) => has(re, specialtyText) && !(only.unless && only.unless.test(specialtyText))).map(([word]) => word);

    // ─── Score ───
    const siteEvidence = [...find(EXHIBITIONS, site).words, ...find(REPRESENTED, site).words, ...find(CONSIGN, site).words,
        ...find(ADVISOR, site).words, ...find(DEALER, site).words, ...(find(AUCTION, site).count >= 2 ? ['auction'] : [])];
    let score = 0;
    if (categoryType || auctionListed) score += 30;
    if (nameType) score += 25;
    if (descriptionType) score += 10;
    // Decided by the website, or an antique shop that deals in art.
    if (type && !categoryType && !nameType && !descriptionType && !auctionListed) score += 15;
    score += Math.min(new Set(siteEvidence).size, 5) * 4;
    score += Math.min(specialties.length, 5) * 2;
    if (accepts_submissions !== 'unknown') score += 3;
    if (consigned) score += 3;
    // A well-reviewed place sees more collectors.
    const reviews = Number(lead.review_count) || 0;
    if (reviews >= 100) score += 10;
    else if (reviews >= 20) score += 5;
    if (tier === 'Non-profit / museum') score = Math.min(score, 10);
    else if (tier === 'Not a buyer') score = Math.min(score, 15);
    score = Math.max(0, Math.min(100, score));

    if (type) {
        why.push(...find(AUCTION, `${name} · ${category}`).words, ...find(ADVISOR, listing).words, ...find(DEALER, listing).words,
            ...find(GALLERY_TEXT, listing).words);
    }
    why.push(...[...new Set(siteEvidence)].map(w => `${w} (site)`));
    const evidence = [...new Set(why.filter(Boolean))].slice(0, 8).join(', ');

    return {
        score,
        tier,
        evidence,
        provisional,
        fields: {
            art_type: ART_TYPE[tier] || '',
            accepts_submissions,
            submission_url: submissionUrl,
            accepts_consignments: consigned ? 'yes' : 'unknown',
            consign_url: consignUrl,
            specialties: specialties.join('; '),
        },
    };
}
