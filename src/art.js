/**
 * The art campaign, for Varnish AI: which places buy artwork, sell it on
 * consignment, represent its artists, or advise the collectors who do?
 * Varnish AI helps people sell artwork and recommends these buyers to them,
 * so the campaign builds a directory of galleries, auction houses, art
 * dealers and art advisors from Google Business Profiles in the US.
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
const words = (alternatives, end = WHOLE) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})${end}`, 'giu');
const has = (re, text) => String(text || '').search(re) !== -1;

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
]);
/** The Maps description says so: "Non-profit gallery…", "University gallery…". */
const NONPROFIT_DESCRIPTION = words(['non-?profit', 'not[- ]for[- ]profit', '501\\s?\\(?c\\)?\\s?\\(?3\\)?', '(?:university|college)(?:[\'’]s)? (?:art )?(?:gallery|museum)']);
/** …or the website: "X is a 501(c)(3) non-profit". "A portion goes to a non-profit" is not this. */
const NONPROFIT_SITE = words(['(?:is|are) an? (?:registered |independent |private |public |community )?(?:non-?profit|not[- ]for[- ]profit|501\\s?\\(?c\\)?\\s?\\(?3\\)?)']);

/**
 * Is this an art organisation we cannot sell through? Called by isSellable
 * (relevance.js) for the art campaign, so these places are dropped at the
 * feed like synagogues are in a Judaica run.
 * @returns {string} the reason, or '' when it is not one
 */
export function artNonProfit(lead) {
    const name = clean(museumWordsOut(lead.business_name));
    const category = clean(lead.category);
    const hit = find(NONPROFIT_ART, name).words[0] || find(NONPROFIT_ART, category).words[0]
        || find(NONPROFIT_DESCRIPTION, clean(lead.maps_description)).words[0];
    return hit ? `non-profit / museum (${hit})` : '';
}

// ─── Not buyers ───────────────────────────────────────────────────────────

/** Picture framers. Many "art galleries" on Maps are frame shops. */
const FRAME = words(['fram(?:e|es|ed|er|ers|ing)', 'framemak\\w*', 'framery']);

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
]);
/** The Maps description of a paint-and-sip studio or tattoo parlour. */
const NOT_BUYER_DESCRIPTION = words(['tattoo\\w*', 'paint(?:ing)?\\s*(?:and|&|n)\\s*sip', 'sip\\s*(?:and|&|n)\\s*paint', 'bring your own (?:wine|bottle|byob)']);

/** An artist's own studio sells its own work, not anyone else's. */
const ARTIST_CATEGORY = words(['artists?', 'art studio', 'sculptors?', 'potters?', 'ceramicists?', 'glass ?blow\\w*', 'craftsm[ae]n', 'art handcraft']);
const ARTIST_NAME = words(['studios?', 'atelier', 'photography', 'photographer', 'photos?']);
/** Gift, souvenir and craft shops. */
const GIFT_CATEGORY = words(['gifts?', 'gift shop', 'souvenirs?', 'handicrafts?', 'crafts?', 'novelty']);
/** The words a buyer puts in its name. */
const BUYER_NAME = words(['gall?er(?:y|ies|ie|ia|ía)', 'auction\\w*', 'dealers?', 'advis\\w*', 'consult\\w*']);
const GALLERY = words(['gall?er(?:y|ies|ie|ia|ía)']);
const FINE_ART = words(['fine arts?']);

/** Categories a buyer can have: art, galleries, auction, antiques, appraisers, consultants. ("Car dealer" is not one.) */
const ART_CATEGORY = words(['art', 'arts', 'fine arts?', 'gall?er\\w*', 'auction\\w*', 'antiques?', 'antiquarian', 'apprais\\w*', 'consult\\w*', 'advis\\w*', 'collectibles?']);
/** Categories that say nothing: an advisor is often a "Corporate office" or a "Consultant". */
const GENERIC_CATEGORY = /^(store|shop|business|company|corporate office|offices?|service|establishment|point of interest|business center|management company|)$/i;
const ANTIQUE = words(['antiques?', 'antiquarian']);
const APPRAISER = words(['apprais\\w*']);
/** Art words for antique shops, appraisers and names that say nothing else. */
const ART_WORD = words(['art', 'arts', 'artworks?', 'fine arts?', 'paintings?', 'gall?er(?:y|ies|ie|ia|ía)', 'collect(?:ors?|ions?|ing)']);

// ─── What kind of buyer ───────────────────────────────────────────────────

/** "Auction", "Auctions", "Auctioneers", "Auction house". */
const AUCTION = words(['auction\\w*'], '');
/** Art advisory and consulting, from any text. */
const ADVISOR = words(['art[- ](?:advis|consult)\\w*', '(?:fine[- ]art|collection|collections|curatorial|corporate art) (?:advis|consult)\\w*', 'art acquisition', 'collection management', 'corporate art (?:collections?|programs?|services)']);
/** In a name, "Advisory" or "Consulting" alone is enough once the listing is about art. */
const ADVISOR_NAME = words(['advis(?:ory|ors?|ers?|ing)', 'consult(?:ants?|ancy|ing)', 'curat(?:orial|ion) services']);
const DEALER = words([
    '(?:fine[- ]art|art|private|art (?:and|&) antiques?|antiques? (?:and|&) (?:fine )?art) dealers?', 'dealers? (?:in|of) (?:[\\p{L}-]+ ){0,3}(?:art|paintings|prints|photographs|sculpture)',
    'private (?:sales|treaty)', 'secondary market',
    'we(?:[\'’]re| are)? (?:always |actively |currently )?(?:buy|buying|purchas\\w*|acquir\\w*)(?: and sell(?:ing)?)?[^.!?;\\n]{0,30}?(?:art|artworks?|paintings?|collections?|estates?|prints|sculptures?|photographs|works)',
    '(?:buying|purchasing) (?:fine )?(?:art|artworks?|paintings|collections|estates)',
]);
const DEALER_NAME = words(['dealers?']);

/** A gallery's website: exhibitions and the artists it represents. */
const EXHIBITIONS = words(['(?:current|upcoming|past|recent|future|new|forthcoming) exhibitions?', 'exhibitions? (?:on view|opening|calendar|schedule|archive|history)', 'now on view', 'on view (?:through|until|now)', 'opening reception']);
/** "Our artists" is never a single artist's own site, but "Exhibitions" is (the CV). */
const REPRESENTED = words(['(?:represented|gallery|our) artists', 'artists represented', '(?:the gallery|we) represents?', 'represent(?:s|ing)?[^.!?;\\n]{0,40}?artists']);
const GALLERY_TEXT = words(['gall?er(?:y|ies|ie|ia|ía)', 'exhibitions?', 'represent(?:s|ing)? (?:[\\p{L}-]+ ){0,3}artists']);

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
]);

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
]);
/** "We are not accepting consignments at this time." */
const NO_CONSIGN = [
    new RegExp(`(?<![\\p{L}])${NEG}${ADVERBS}\\s+(?:accept|tak(?:e|es|ing)|offer|handl)\\w*(?:\\s+(?:any|new|outside|work|works|art|on))*\\s+consign`, 'iu'),
    /\bno consignments\b/i,
];

/**
 * Links to the pages these fields point at: an address or link text that
 * says submission(s) / open call / submit your work, and one that says
 * consign / sell with us / we buy / valuation / appraisal. A "Consignment
 * submissions" link is a consignment page. Exported for the contact lookup,
 * which reads one page of each (CAMPAIGNS.art.US.followLinks).
 */
export const SUBMISSION_LINK = /^(?!.*(?:consign|auction|apprais|valuation|estimate|\bsell)).*?(?:submissions?|open[-_ ]?calls?\b|call[-_ ]for[-_ ](?:artists|entries|submissions|art)\b|submit[-_ ](?:your[-_ ])?(?:work|art|artwork|portfolio)\b)/i;
export const CONSIGN_LINK = /consign|(?:^|[/\s])sell(?:ing)?(?:[-_ ](?:with[-_ ]?us|through[-_ ]us|your|art|artwork)|[/\s]|$)|how[-_ ]to[-_ ]sell|we[-_ ]buy|valuations?|apprais|(?:auction|free)[-_ ]estimates?|request[-_ ](?:an?[-_ ])?(?:estimate|valuation|appraisal)/i;
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

/**
 * The fixed vocabulary of `specialties`, in the order they are listed. Each
 * entry counts only when the listing or the site names it. Single words that
 * mean many things ("modern", "contemporary", "design", "glass") need an art
 * word next to them: "contemporary framing", "modern furniture" and "glass
 * doors" are not specialties.
 */
export const SPECIALTIES = [
    ['contemporary', words(['contemporary (?:art|arts|artists?|paintings?|works?|photography|sculpture|ceramics|craft|fine art|realism|prints?|abstract\\w*|african|asian|latin|native|american|chinese|indian|glass|gallery|masters?|works on paper)', '(?:modern|post-?war) (?:and|&) contemporary'])],
    ['modern', words(['modern (?:art|arts|masters?|paintings?|works?|prints?|sculpture|american|british|european|and contemporary|& contemporary)', 'modernis[mt]s?'])],
    ['post-war', words(['post-?war', 'postwar'])],
    ['impressionist', words(['(?:post-)?impressionis[mt]s?'])],
    ['old masters', words(['old masters?'])],
    ['american art', words(['(?<!(?:native|latin|african|north|south|central|asian|mexican|indian|pan)[- ])american (?:art|paintings?|artists?|masters?|modernism|impressionis[mt]s?|realism|regionalism|illustration)', 'hudson river school'])],
    ['african american art', words(['african[- ]american (?:art|artists?|masters?|fine art)', 'black artists'])],
    ['latin american', words(['latin[- ]american', 'latin(?:o|x|e) (?:art|artists?)'])],
    ['asian art', words(['asian (?:art|antiques?|artists?|contemporary|works of art)', '(?:chinese|japanese|korean|southeast asian|himalayan|tibetan) (?:art|paintings?|ceramics|porcelain|antiques?|prints|works of art|scrolls?|woodblocks?)', 'ukiyo-?e'])],
    ['african art', words(['african (?:art|arts|artists?|sculpture|masks?|textiles?|contemporary art|tribal art)', 'tribal art'])],
    ['native american', words(['native american (?:art|artists?|pottery|jewelry|rugs?|baskets?|weavings?|textiles?|antiques?|beadwork|paintings?)', '(?:pueblo|navajo|hopi|zuni|apache) (?:pottery|rugs?|textiles?|weavings?|jewelry|baskets?|art)', 'kachinas?', 'indigenous (?:art|artists?)', 'american indian art'])],
    ['western art', words(['western (?:art|american art|paintings?|bronzes?|artists?|landscapes?)', 'art of the (?:american )?west', 'cowboy art'])],
    ['outsider art', words(['outsider art', 'self-taught (?:art|artists?)', 'art brut', 'visionary art'])],
    ['folk art', words(['folk art'])],
    ['photography', new RegExp(`(?<![\\p{L}\\p{N}])(?<!installation |installation view |exhibition |website |site |images? |photos? )(?:fine art |contemporary |vintage |documentary )?photograph(?:y|s|ic)(?![\\p{L}\\p{N}])(?!\\s*(?:by|credits?|:|©))`, 'giu')],
    ['prints', words(['(?:fine art )?prints', 'printmak\\w*', 'lithograph\\w*', 'etchings?', 'screen ?prints?', 'serigraphs?', 'woodcuts?', 'editions and multiples', 'multiples'])],
    ['sculpture', words(['sculptur(?:e|es|al)', 'sculptors?', 'bronzes'])],
    ['works on paper', words(['works? on paper'])],
    ['ceramics', words(['ceramics?', '(?:studio |art )?pottery', 'porcelain'])],
    ['glass', words(['(?:studio|art|contemporary|blown|fused|sculptural|venetian|murano) glass', 'glass (?:art|sculptures?|artists?)'])],
    ['design', words(['(?:collectible|collectable|20th[- ]century|mid-century|midcentury|modernist|scandinavian|italian|french|historic|contemporary) design', 'design (?:objects|gallery)', 'mid-?century modern'])],
    ['decorative arts', words(['decorative arts?', 'objets? d[\'’]art', 'fine (?:and|&) decorative'])],
    ['emerging artists', words(['emerging (?:and (?:established|mid-career) )?(?:artists?|talent|art)'])],
];

/**
 * Museum names say nothing about the gallery: "near the Asian Art Museum",
 * "the Museum of Modern Art", "the Institute of Contemporary Art". They are
 * capitalised, which keeps "contemporary art and the museum shop" intact.
 */
const MUSEUM_NAMES = /(?<![\p{L}])(?:(?:\p{Lu}[\p{L}'’.-]*\s+){0,3}Museum(?:\s+of(?:\s+the)?(?:\s+\p{Lu}[\p{L}'’.-]*){1,4})?|(?:Institute|Cent(?:er|re))\s+(?:of|for)\s+(?:\p{Lu}[\p{L}'’.-]*\s+){0,3}Arts?)(?![\p{L}])/gu;

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
    const specialtyText = all.replace(MUSEUM_NAMES, ' ');
    const specialties = SPECIALTIES.filter(([, re]) => has(re, specialtyText)).map(([word]) => word);

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
