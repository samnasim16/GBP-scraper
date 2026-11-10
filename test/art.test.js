import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveCountry, resolveLocations, buildQueryMatrix } from '../src/config.js';
import { scoreRelevance, isSellable, isTarget } from '../src/relevance.js';
import { SPECIALTIES } from '../src/art.js';
import { ContactEnricher, findLinks } from '../src/contacts.js';
import { relevanceFields, scrapeQuery, pickCity } from '../src/maps.js';
import { extractFeedCards, extractDetail } from '../src/dom-extract.js';
import { loadTemplate, renderEmail } from '../src/email-template.js';
import { loadWhatsAppTemplate } from '../src/whatsapp.js';
import { createSaver, prepareLeads } from '../src/output.js';

const ART = resolveCountry({ country: 'US', campaign: 'art' });
/** A place found by the US art campaign. */
const place = (business_name, category, extra = {}) => ({ business_name, category, country: 'US', campaign: 'art', ...extra });
const tierOf = (lead, siteText = '') => scoreRelevance(lead, siteText).tier;
/** The leads.json fields, from the listing, the site text and the links found. */
const fieldsOf = (lead, siteText = '', links = []) => relevanceFields({ ...lead, _siteLinks: links }, siteText);
/** What the feed does with a card: drop it, or open it. */
const droppedAtFeed = (lead) => {
    const r = scoreRelevance(lead);
    return !isSellable(lead).ok || (ART.dropAtFeed.includes(r.tier) && !r.provisional);
};
const fixture = (f) => fs.readFileSync(new URL(`./fixtures/gallery-us/${f}`, import.meta.url), 'utf8');

const BUYER_TYPES = ['gallery', 'auction_house', 'dealer', 'art_advisor', ''];
/** The contract: every field present, every value one the Varnish importer accepts. */
function assertContract(row) {
    const label = row.business_name;
    assert.ok(BUYER_TYPES.includes(row.art_type), `${label}: art_type ${row.art_type}`);
    assert.ok(['yes', 'no', 'unknown'].includes(row.accepts_submissions), `${label}: accepts_submissions`);
    assert.ok(['yes', 'unknown'].includes(row.accepts_consignments), `${label}: accepts_consignments`);
    for (const k of ['submission_url', 'consign_url']) assert.match(row[k], /^(https?:\/\/\S+)?$/, `${label}: ${k}`);
    assert.equal(typeof row.specialties, 'string');
    const vocabulary = SPECIALTIES.map(([w]) => w);
    if (row.specialties) for (const s of row.specialties.split('; ')) assert.ok(vocabulary.includes(s), `${label}: specialty "${s}"`);
    // art_type follows the tier; non-buyers have none.
    const type = { Gallery: 'gallery', 'Auction house': 'auction_house', 'Art dealer': 'dealer', 'Art advisor': 'art_advisor' }[row.relevance_tier] || '';
    assert.equal(row.art_type, type, `${label}: art_type for ${row.relevance_tier}`);
}

test('the art campaign is the US with its own terms, places, templates and folder', () => {
    assert.equal(ART.code, 'US');
    assert.equal(ART.campaign, 'art');
    assert.equal(ART.outputDir, 'output-us-art');
    assert.equal(ART.workbook, 'art-leads.xlsx');
    assert.equal(ART.script, 'art:us');
    assert.equal(ART.phoneCode, '1');
    assert.deepEqual(ART.includeTiers, ['Gallery', 'Auction house', 'Art dealer', 'Art advisor']);
    assert.deepEqual(ART.highYield, ['Art gallery', 'Auction house', 'Art dealer', 'Art advisor']);
    for (const term of ['Art gallery', 'Contemporary art gallery', 'Fine art gallery', 'Auction house', 'Art auction', 'Art dealer', 'Art consultant', 'Art advisor']) {
        assert.ok(ART.categories.includes(term), term);
    }
    // The Judaica profile is untouched.
    const US = resolveCountry({ country: 'US' });
    assert.equal(US.outputDir, 'output-us');
    assert.equal(US.campaign, undefined);
    assert.match(US.emailTemplate, /partnership-email-us\.txt$/);
    assert.ok(US.categories.includes('Judaica'));
    assert.throws(() => resolveCountry({ country: 'DE', campaign: 'art' }), /set up for United States, Israel, Worldwide only, not Germany — for Germany alone use "country": "WORLD", "states": \["DE"\]/);

    const locs = resolveLocations({ country: 'US', campaign: 'art' }, () => {});
    for (const city of ['New York, NY', 'Brooklyn, NY', 'Los Angeles, CA', 'San Francisco, CA', 'Chicago, IL', 'Miami, FL', 'Palm Beach, FL',
        'Boston, MA', 'Santa Fe, NM', 'Dallas, TX', 'Houston, TX', 'Seattle, WA', 'Philadelphia, PA', 'Washington, DC', 'Atlanta, GA',
        'Denver, CO', 'Scottsdale, AZ', 'Charleston, SC', 'Nashville, TN', 'Minneapolis, MN', 'Chelsea, New York, NY', 'Canyon Road, Santa Fe, NM']) {
        assert.ok(locs.some(l => l.city === city), city);
    }
    // "Charleston" alone is also in West Virginia: every place carries its state.
    assert.ok(locs.every(l => /, [A-Z]{2}$/.test(l.city)));
    assert.ok(!locs.some(l => l.city === 'Borough Park, Brooklyn, NY'), 'the Judaica districts are not gallery districts');
    const q = buildQueryMatrix(locs, ART.categories, ART.highYield);
    assert.equal(q[0].text, 'Art gallery New York, NY');
    assert.ok(q.slice(0, locs.length).every(x => x.category === 'Art gallery'));
    // The City column drops the district and the state.
    assert.equal(pickCity('', 'Chelsea, New York, NY', ART), 'New York');
    assert.equal(pickCity('2100 Canyon Rd, Santa Fe, NM 87501', 'Canyon Road, Santa Fe, NM', ART), 'Santa Fe');
});

test('the art input files and npm scripts', () => {
    const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
    const pkg = read('package.json');
    assert.equal(pkg.scripts['art:us'], 'node src/main.js --input ./input.us-art.json');
    assert.equal(pkg.scripts['smoke:art:us'], 'node src/main.js --input ./input.us-art-smoke.json');
    const full = read('input.us-art.json');
    assert.equal(resolveCountry(full).campaign, 'art');
    assert.deepEqual(full.includeTiers, ART.includeTiers);
    const smoke = read('input.us-art-smoke.json');
    // The same shape as the other smoke inputs: one city, 2 terms, 10 places, a visible browser.
    assert.deepEqual(Object.keys(smoke).filter(k => !['country', 'campaign'].includes(k)), Object.keys(read('input.us-smoke.json')).filter(k => k !== 'country'));
    assert.equal(resolveCountry(smoke).campaign, 'art');
    assert.equal(smoke.cities.length, 1);
    assert.equal(smoke.searchCategories.length, 2);
    assert.equal(smoke.maxLeads, 10);
    assert.equal(smoke.browser.headless, false);
    assert.equal(smoke.outputDir, 'output-us-art-smoke');
});

test('a frame shop is not a buyer: framing beats "gallery" unless the site shows exhibitions or represented artists', () => {
    assert.equal(tierOf(place('Canyon Road Gallery & Framing', 'Art gallery')), 'Not a buyer');
    assert.equal(tierOf(place('Frame Masters', 'Picture frame shop')), 'Not a buyer');
    assert.equal(tierOf(place('Smith Gallery', 'Picture frame shop')), 'Not a buyer');
    assert.equal(tierOf(place('Canyon Road Gallery & Framing', 'Art gallery'), 'Custom framing, matting and shadow boxes. Fine art prints.'), 'Not a buyer');
    assert.equal(tierOf(place('Canyon Road Gallery & Framing', 'Art gallery'), 'Current exhibitions: Western landscapes. Opening reception Friday.'), 'Gallery');
    assert.equal(tierOf(place('Canyon Road Gallery & Framing', 'Art gallery'), 'The gallery represents twelve New Mexico artists.'), 'Gallery');
    // A frame shop that calls itself a gallery is opened, so its site can be read;
    // one that doesn't is dropped at the feed. "Timeframe" is not framing.
    assert.equal(droppedAtFeed(place('Canyon Road Gallery & Framing', 'Art gallery')), false);
    assert.equal(droppedAtFeed(place('Frame Masters', 'Picture frame shop')), true);
    assert.equal(tierOf(place('Timeframe Gallery', 'Art gallery')), 'Gallery');
    assert.ok(!isTarget({ relevance_tier: tierOf(place('Canyon Road Gallery & Framing', 'Art gallery')) }, ART.includeTiers));
});

test('galleries, auction houses, art dealers and art advisors, from the name, category, description or site', () => {
    const y = place('Y Fine Art', 'Art gallery');
    assert.equal(tierOf(y), 'Gallery');
    assert.equal(fieldsOf(y).art_type, 'gallery');
    assert.equal(tierOf(place('Galerie Lumière', 'Art gallery')), 'Gallery');
    assert.equal(tierOf(place('Lakeshore Auctioneers', 'Auction house')), 'Auction house');
    assert.equal(tierOf(place('Stair Galleries', 'Auction house')), 'Auction house');
    assert.equal(tierOf(place('Clarke Auction Gallery', 'Art gallery')), 'Auction house');
    assert.equal(fieldsOf(place('Lakeshore Auctioneers', 'Auction house')).art_type, 'auction_house');
    assert.equal(tierOf(place('Whitfield Fine Art', 'Art dealer')), 'Art dealer');
    assert.equal(fieldsOf(place('Whitfield Fine Art', 'Art dealer')).art_type, 'dealer');
    assert.equal(tierOf(place('Whitfield Fine Art', ''), 'We buy and sell American paintings and estates.'), 'Art dealer');
    assert.equal(tierOf(place('Whitfield Antiques & Fine Art', 'Antique store')), 'Art dealer');
    assert.equal(tierOf(place('Meridian Art Advisory', 'Consultant')), 'Art advisor');
    assert.equal(fieldsOf(place('Meridian Art Advisory', 'Consultant')).art_type, 'art_advisor');
    assert.equal(tierOf(place('Meridian Advisory', 'Art gallery')), 'Art advisor');
    assert.equal(tierOf(place('Jones & Co', 'Corporate office', { maps_description: 'Art consultant for private and corporate collections' })), 'Art advisor');
    assert.equal(tierOf(place('Jones & Co', 'Corporate office'), 'Art advisory: we help collectors build and manage their collections.'), 'Art advisor');
    // "Salon 94" is a gallery, not a hair salon; the Arts District is a neighbourhood.
    assert.equal(tierOf(place('Salon 94', 'Art gallery')), 'Gallery');
    assert.equal(tierOf(place('Arts District Gallery', 'Art gallery')), 'Gallery');
    for (const lead of [y, place('Lakeshore Auctioneers', 'Auction house'), place('Whitfield Fine Art', 'Art dealer'), place('Meridian Art Advisory', 'Consultant')]) {
        assert.ok(isTarget({ relevance_tier: tierOf(lead) }, ART.includeTiers), lead.business_name);
    }
});

test('not buyers: supplies, classes, tattoo, printing, photographers, interiors, furniture, murals, artists\' studios, gift shops', () => {
    for (const [name, category, description] of [
        ['Artist & Craftsman Supply', 'Art supply store'],
        ["Pinot's Palette", 'Art gallery'],
        ['Canvas & Cocktails', 'Art studio', 'Paint and sip classes for groups, BYOB'],
        ['Young Rembrandts Art School', 'Art school'],
        ['Ink Masters Tattoo Gallery', 'Tattoo shop'],
        ['Gallery Ink', 'Tattoo shop'],
        ['FedEx Office Print & Ship Center', 'Print shop'],
        ['Jane Roe Photography', 'Photographer'],
        ['Studio Hues Interiors', 'Interior designer'],
        ['Gallery Furniture', 'Furniture store'],
        ['Wall Mural Co', 'Painter'],
        ['Jane Doe', 'Artist'],
        ['Jane Doe Studio', 'Art gallery'],
        ['Santa Fe Gifts & Gallery', 'Gift shop'],
        ['Gallery Cafe', 'Cafe'],
        ['The Galleria', 'Shopping mall'],
        ['Galleria Motors', 'Car dealer'],
    ]) {
        assert.equal(tierOf(place(name, category, { maps_description: description })), 'Not a buyer', name);
        assert.equal(fieldsOf(place(name, category, { maps_description: description })).art_type, '', name);
    }
    // Dropped at the feed unless the site might still make it a gallery.
    assert.equal(droppedAtFeed(place("Pinot's Palette", 'Art gallery')), true);
    assert.equal(droppedAtFeed(place('Ink Masters Tattoo Gallery', 'Tattoo shop')), true);
    assert.equal(droppedAtFeed(place('Jane Doe', 'Artist')), true);
    assert.equal(droppedAtFeed(place('Jane Doe Studio', 'Art gallery')), false);
    // An artist's CV lists exhibitions; only represented artists make it a gallery.
    assert.equal(tierOf(place('Jane Doe Studio', 'Art gallery'), 'Exhibitions: 2019 solo show. Past exhibitions.'), 'Not a buyer');
    assert.equal(tierOf(place('Jane Doe Studio', 'Art gallery'), 'Gallery artists: Ann Lee, Bo Kim, Cy Ray.'), 'Gallery');
    assert.equal(tierOf(place('Studio 21 Gallery', 'Art gallery')), 'Gallery');
    assert.equal(tierOf(place('Santa Fe Gifts & Gallery', 'Gift shop'), 'Upcoming exhibitions and represented artists.'), 'Gallery');
});

test('museums, art centers, arts councils and university galleries are Non-profit / museum; a gallery in the Museum District stays', () => {
    for (const [name, category, description] of [
        ['Denver Art Museum', 'Art museum'],
        ['Peters Valley Art Center', 'Art center'],
        ['Arts Council of Greater Nashville Gallery', 'Art gallery'],
        ['University Art Gallery', 'Art gallery'],
        ['Rothko Foundation Gallery', 'Art gallery'],
        ['Westside Art League', 'Non-profit organization'],
        ['Second Street Gallery', 'Art gallery', 'Non-profit contemporary art space'],
    ]) {
        const lead = place(name, category, { maps_description: description });
        assert.equal(isSellable(lead).ok, false, name);
        assert.equal(tierOf(lead), 'Non-profit / museum', name);
        assert.equal(fieldsOf(lead).art_type, '', name);
    }
    // The site can say so too.
    assert.equal(tierOf(place('Second Street Gallery', 'Art gallery'), 'Second Street Gallery is a 501(c)(3) non-profit.'), 'Non-profit / museum');
    assert.equal(tierOf(place('Hudson Line Gallery', 'Art gallery'), 'Ten percent of sales goes to a non-profit.'), 'Gallery');
    // "Museum District", "Museum Hill" and "museum-quality" are not museums.
    for (const name of ['Museum District Gallery', 'Gallery on Museum Hill', 'Museum Row Fine Art']) {
        const lead = place(name, 'Art gallery', { maps_description: 'Contemporary art gallery in the Museum District' });
        assert.equal(isSellable(lead).ok, true, name);
        assert.equal(tierOf(lead), 'Gallery', name);
        assert.equal(droppedAtFeed(lead), false, name);
    }
    assert.equal(tierOf(place('Museum Quality Framing', 'Picture frame shop')), 'Not a buyer');
    // The Judaica run keeps its rule: there, any museum name is an institution.
    assert.equal(isSellable({ business_name: 'Museum District Gallery', category: 'Art gallery' }).ok, false);
});

test('accepts_submissions: "no" in the usual phrasings, "yes" with guidelines or an open call, and "no" wins', () => {
    const subs = (site) => fieldsOf(place('Hudson Line Gallery', 'Art gallery'), site).accepts_submissions;
    for (const site of [
        'We do not accept unsolicited submissions.',
        'Please note: the gallery does not accept unsolicited artist submissions or portfolios.',
        "We don't accept submissions.",
        'The gallery is not currently accepting new artists.',
        'We are not accepting submissions at this time.',
        'We are unable to review portfolios.',
        'The gallery does not review unsolicited portfolios.',
        'We are not taking on new artists.',
        'We are not looking for new artists.',
        'We will not be accepting submissions this year.',
        'We cannot accept unsolicited proposals.',
        'Unsolicited submissions will not be reviewed or returned.',
        'Unsolicited materials cannot be returned.',
        'Submissions are currently closed.',
        'The gallery is closed to submissions.',
        'Please do not send portfolios by mail.',
        'No unsolicited submissions.',
        'No submissions, please.',
        'Representation is by invitation only.',
        'We do not represent new artists.',
        'We are not open to new artist submissions.',
    ]) assert.equal(subs(site), 'no', site);
    for (const site of [
        'Artist Submissions: please read our submission guidelines.',
        'Open call for artists: deadline March 1.',
        'Submit your work using the form below.',
        'We welcome submissions from emerging artists.',
        'Now accepting submissions for our summer show.',
        'How to submit: email five images.',
    ]) assert.equal(subs(site), 'yes', site);
    assert.equal(subs('Artist submissions: we do not accept unsolicited submissions.'), 'no');
    assert.equal(subs('Current exhibitions. Represented artists.'), 'unknown');
    // Not refusals: a rule about how to send, a fee, a reply.
    assert.notEqual(subs('We do not accept submissions via Instagram; please use our online form.'), 'no');
    assert.notEqual(subs('Open call: we do not charge a fee for submissions.'), 'no');
    assert.notEqual(subs('Artist submissions are reviewed quarterly; we are not able to respond to every submission.'), 'no');
    // An auction house's "submit your artwork for an estimate" is a consignment.
    const auction = fieldsOf(place('Lakeshore Auctioneers', 'Auction house'), 'Submit your artwork for a free auction estimate.');
    assert.equal(auction.accepts_submissions, 'unknown');
    assert.equal(auction.accepts_consignments, 'yes');
    // A submissions page among the links found counts, unless it says no.
    const link = [{ url: 'https://hudsonline.example/submissions', text: 'Submissions' }];
    assert.equal(fieldsOf(place('Hudson Line Gallery', 'Art gallery'), '', link).accepts_submissions, 'yes');
    assert.equal(fieldsOf(place('Hudson Line Gallery', 'Art gallery'), 'Submissions are closed.', link).accepts_submissions, 'no');
});

test('accepts_consignments: consigning, selling with us, "we buy", valuations; a refusal is unknown', () => {
    const consign = (site, extra = {}) => fieldsOf(place('Lakeshore Auctioneers', 'Auction house', extra), site).accepts_consignments;
    for (const site of [
        'Consign with us.',
        'We are now accepting consignments for our fall sale.',
        'Thinking of selling? Sell your art at auction.',
        'Selling with us is simple.',
        'We buy and sell fine art and estates.',
        "We're always buying paintings by American artists.",
        'Appraisals for sale at auction.',
        'Request a free auction estimate.',
        'Online valuation request form.',
        'Complimentary appraisals every Tuesday.',
    ]) assert.equal(consign(site), 'yes', site);
    assert.equal(consign('', { maps_description: 'Auction house accepting consignments of fine art' }), 'yes');
    assert.equal(consign('Upcoming auctions and past results.'), 'unknown');
    assert.equal(consign('We are not accepting consignments at this time.'), 'unknown');
    assert.equal(consign('When you buy art from us, shipping is free.'), 'unknown');
});

test('submission_url and consign_url are absolute links to the pages found', () => {
    const links = [
        { url: 'https://lakeshore.example/buy', text: 'Buy' },
        { url: 'https://lakeshore.example/sell', text: 'Sell' },
        { url: 'https://lakeshore.example/consign', text: 'Consign' },
        { url: 'https://lakeshore.example/appraisals', text: 'Appraisals' },
        { url: 'https://lakeshore.example/consignment-submissions', text: 'Consignment submissions' },
        { url: 'https://lakeshore.example/page?id=7', text: 'Artist submissions' },
        { url: 'https://lakeshore.example/open-call-2026', text: 'Open call' },
    ];
    const f = fieldsOf(place('Lakeshore Auctioneers', 'Auction house'), '', links);
    // "Consign" beats "Sell"; a "Consignment submissions" page is not an artist submission page.
    assert.equal(f.consign_url, 'https://lakeshore.example/consign');
    assert.equal(f.accepts_consignments, 'yes');
    // A link whose address says so beats one whose text alone does.
    assert.equal(f.submission_url, 'https://lakeshore.example/open-call-2026');
    assert.equal(fieldsOf(place('X', 'Art gallery'), '', [{ url: 'https://x.example/we-buy', text: 'We Buy' }]).consign_url, 'https://x.example/we-buy');
    // No links read (listing only): no URLs.
    const bare = fieldsOf(place('Lakeshore Auctioneers', 'Auction house', { maps_description: 'Consignments welcome' }));
    assert.equal(bare.consign_url, '');
    assert.equal(bare.submission_url, '');

    // The contact lookup's side: relative links made absolute, the page itself
    // when its own address matches, social sites and images skipped.
    const found = findLinks('<a href="/artist-submissions">Artist Submissions</a> <a href="consign.html">Sell</a> <a href="/about">About</a>'
        + ' <a href="https://www.instagram.com/x/submit">Submit your work</a> <a href="/open-call.jpg">Open call</a>'
        + ' <a href="https://x.submittable.com/submit">Submit your work</a> <a href="mailto:submissions@x.example">Email</a>',
    'https://x.example/open-call', ART.followLinks);
    assert.deepEqual(found.map(l => l.url), ['https://x.example/open-call', 'https://x.example/artist-submissions', 'https://x.example/consign.html',
        'https://x.submittable.com/submit']);
});

test('specialties: a fixed vocabulary, lower case, only what the listing or site names', () => {
    const spec = (site, extra = {}) => fieldsOf(place('Hudson Line Gallery', 'Art gallery', extra), site).specialties;
    assert.equal(spec('Contemporary art, photography and works on paper by emerging artists.'), 'contemporary; photography; works on paper; emerging artists');
    assert.equal(spec('Impressionist and modern art. Old Masters. Post-war and contemporary sculpture.'),
        'contemporary; modern; post-war; impressionist; old masters; sculpture');
    assert.equal(spec('Native American pottery, Navajo rugs and Western art of the American West.'), 'native american; western art; ceramics');
    assert.equal(spec('Latin American and Asian art; African art; outsider art and folk art; studio glass; mid-century design; decorative arts; fine prints.'),
        'latin american; asian art; african art; outsider art; folk art; prints; glass; design; decorative arts');
    assert.equal(spec('Hudson River School paintings and African American artists.'), 'american art; african american art');
    assert.equal(spec('', { maps_description: 'Gallery of contemporary photography' }), 'contemporary; photography');
    // Not specialties: museum names, credits, framing and furniture words.
    assert.equal(spec('Near the Asian Art Museum and the Museum of Modern Art. Installation photography by Sam Lee. Contemporary framing.'), '');
    assert.equal(spec('Native American Heritage Month: we acknowledge the land.'), '');
    // Every word is from the vocabulary, in its order.
    const vocab = SPECIALTIES.map(([w]) => w);
    const got = spec('Sculpture, photography, contemporary art').split('; ');
    assert.deepEqual(got, [...got].sort((a, b) => vocab.indexOf(a) - vocab.indexOf(b)));
});

/** A fake website: path → HTML; anything else is a 404. Records what was fetched. */
function fakeHttp(pages) {
    const fetched = [];
    return {
        fetched,
        async fetchText(url) {
            fetched.push(url);
            const u = new URL(url);
            const body = pages[u.origin + u.pathname];
            return body ? { ok: true, status: 200, body, url } : { ok: false, status: 404, body: '', url };
        },
    };
}
const ART_CONTACTS = () => ({ phoneCode: ART.phoneCode, keyPage: ART.contactKeyPage, guessPaths: ART.contactPaths, followLinks: ART.followLinks, delayMs: 0, concurrency: 1 });

test('end to end: a gallery site gives the email, its submission guidelines and its specialties', async () => {
    const site = 'https://www.hudsonlinegallery.com';
    const http = fakeHttp({
        [`${site}/`]: fixture('index.html'),
        [`${site}/contact`]: fixture('contact.html'),
        [`${site}/artist-submissions`]: fixture('artist-submissions.html'),
    });
    const lead = place('Hudson Line Gallery', 'Art gallery', { website: `${site}/`, phone: '+12125550100' });
    const result = await new ContactEnricher({ http, config: ART_CONTACTS(), log: () => {} }).enrich(lead);
    Object.assign(lead, relevanceFields(lead, lead._siteText));
    assert.ok(http.fetched.includes(`${site}/artist-submissions`), 'the submissions page is read');
    assert.equal(lead.email, 'info@hudsonlinegallery.com');
    assert.match(lead.other_emails, /submissions@hudsonlinegallery\.com/);
    assert.equal(lead.relevance_tier, 'Gallery');
    assert.equal(lead.art_type, 'gallery');
    assert.equal(lead.accepts_submissions, 'yes');
    assert.equal(lead.submission_url, `${site}/artist-submissions`);
    assert.equal(lead.accepts_consignments, 'unknown');
    assert.equal(lead.consign_url, '');
    // "Whitney Museum of American Art" and "Installation photography by…" say nothing.
    assert.equal(lead.specialties, 'contemporary; photography; sculpture; works on paper; emerging artists');
    assert.ok(result.links.every(l => !/instagram/.test(l.url)));
    assertContract(lead);

    // The same gallery when its submissions page says no.
    const closed = fakeHttp({
        [`${site}/`]: fixture('index.html'),
        [`${site}/contact`]: fixture('contact.html'),
        [`${site}/artist-submissions`]: '<h1>Artist Submissions</h1><p>The gallery is not currently accepting submissions. Please do not send portfolios.</p>',
    });
    const lead2 = place('Hudson Line Gallery', 'Art gallery', { website: `${site}/` });
    await new ContactEnricher({ http: closed, config: ART_CONTACTS(), log: () => {} }).enrich(lead2);
    Object.assign(lead2, relevanceFields(lead2, lead2._siteText));
    assert.equal(lead2.accepts_submissions, 'no');
    assert.equal(lead2.submission_url, `${site}/artist-submissions`, 'the page that states the policy');
});

test('end to end: an auction house with a consign page', async () => {
    const site = 'https://www.lakeshoreauctions.com';
    const http = fakeHttp({
        [`${site}/`]: '<nav><a href="/auctions">Upcoming Auctions</a> <a href="/consign">Consign</a> <a href="/contact-us">Contact Us</a></nav>'
            + '<h1>Lakeshore Auctioneers</h1><p>Asian art, Old Masters and decorative arts at auction since 1985. Past auction results.</p>',
        [`${site}/consign`]: '<h1>Consign with us</h1><p>Request a free auction estimate: send photos of your painting to consign@lakeshoreauctions.com.</p>',
        [`${site}/contact-us`]: '<p>info@lakeshoreauctions.com</p>',
    });
    const lead = place('Lakeshore Auctioneers', 'Auction house', { website: `${site}/` });
    await new ContactEnricher({ http, config: ART_CONTACTS(), log: () => {} }).enrich(lead);
    Object.assign(lead, relevanceFields(lead, lead._siteText));
    assert.ok(http.fetched.includes(`${site}/consign`));
    assert.equal(lead.email, 'info@lakeshoreauctions.com');
    assert.equal(lead.relevance_tier, 'Auction house');
    assert.equal(lead.art_type, 'auction_house');
    assert.equal(lead.accepts_consignments, 'yes');
    assert.equal(lead.consign_url, `${site}/consign`);
    assert.equal(lead.accepts_submissions, 'unknown');
    assert.equal(lead.specialties, 'old masters; asian art; decorative arts');
    assertContract(lead);
});

test('other markets\' contact lookup is unchanged: no links kept, no extra pages read', async () => {
    const http = fakeHttp({
        'https://keterjudaica.com/': '<a href="/contact">Contact</a> <a href="/submissions">Submissions</a> <a href="/consign">Consign</a>',
        'https://keterjudaica.com/contact': '<p>keterjudaica@gmail.com</p>',
    });
    const us = resolveCountry({ country: 'US' });
    const lead = { business_name: 'Keter Judaica', website: 'https://keterjudaica.com/', country: 'US' };
    const result = await new ContactEnricher({ http, config: { keyPage: us.contactKeyPage, guessPaths: us.contactPaths, delayMs: 0 }, log: () => {} }).enrich(lead);
    assert.deepEqual(result.links, []);
    assert.ok(!http.fetched.some(u => /submissions|consign/.test(u)));
    // …and a Judaica lead gets only the three relevance fields.
    assert.deepEqual(Object.keys(relevanceFields(lead, lead._siteText)), ['relevance_tier', 'relevance_score', 'relevance_evidence']);
    assert.equal(scoreRelevance({ business_name: 'Sushi Samba', category: 'Restaurant', country: 'IL', campaign: 'sushi' }).tier, 'Sushi place');
});

test('the feed drops clear non-buyers and museums; every art lead carries the contract fields', async () => {
    let current = '';
    const logs = [];
    const card = (id, name, category) => ({ name, href: `https://www.google.com/maps/place/${id}/data=!1s0x1:0x${id}`, category, rating: 4.7, reviewCount: 80, closedFlag: false });
    const cards = [
        card('a', 'Hudson Line Gallery', 'Art gallery'),
        card('b', 'Canyon Road Gallery & Framing', 'Art gallery'),
        card('c', 'Frame Masters', 'Picture frame shop'),
        card('d', "Pinot's Palette", 'Art studio'),
        card('e', 'City Art Museum', 'Art museum'),
        card('f', 'Museum District Gallery', 'Art gallery'),
        card('g', 'Arts Council Gallery', 'Art gallery'),
        card('h', 'Lakeshore Auctioneers', 'Auction house'),
    ];
    const details = {
        a: { name: 'Hudson Line Gallery', address: '548 W 22nd St, New York, NY 10011', category: 'Art gallery', phone: '+12125550100', websiteUrl: 'https://www.hudsonlinegallery.com/', rating: 4.7, reviews: 80, description: 'Contemporary art gallery' },
        b: { name: 'Canyon Road Gallery & Framing', address: '600 Canyon Rd, Santa Fe, NM 87501', category: 'Art gallery', phone: '+15055550101', rating: 4.5, reviews: 30 },
        f: { name: 'Museum District Gallery', address: '4520 Main St, Houston, TX 77002', category: 'Art gallery', phone: '+17135550102', rating: 4.8, reviews: 40 },
        h: { name: 'Lakeshore Auctioneers', address: '1 N Wacker Dr, Chicago, IL 60606', category: 'Auction house', phone: '+13125550103', rating: 4.6, reviews: 200, description: 'Fine art auctions; consignments welcome' },
    };
    const page = {
        url: () => current || 'https://www.google.com/maps/search/x',
        goto: async (u) => { current = u; },
        $: async (sel) => (sel === 'div[role="feed"]' || sel === 'h1.DUwDvf' ? {} : null),
        $$eval: async () => cards.length,
        waitForSelector: async () => {},
        bringToFront: async () => {},
        evaluate: async (fn, arg) => {
            if (fn === extractFeedCards) return cards;
            if (fn === extractDetail) {
                assert.equal(arg, '1', 'the US phone code');
                return details[current.match(/place\/(\w)/)[1]];
            }
            return null;
        },
    };
    const allLeads = [];
    await scrapeQuery(page, { text: 'Art gallery New York, NY', city: 'New York, NY', state: 'NY' }, { seen: new Set(), allLeads, log: (m) => logs.push(m) },
        { maxResultsPerQuery: 60, maxScrolls: 0, minReviews: 0, maxLeads: 100, delayBetweenListings: 0, keepNonProfits: false, country: ART });
    assert.deepEqual(allLeads.map(l => l.business_name), ['Hudson Line Gallery', 'Canyon Road Gallery & Framing', 'Museum District Gallery', 'Lakeshore Auctioneers']);
    assert.ok(logs.some(m => /non-profit:2 not-a-buyer:2/.test(m)), logs.find(m => /Feed:/.test(m)));
    const [hudson, framing, district, lakeshore] = allLeads;
    assert.equal(hudson.campaign, 'art');
    assert.equal(hudson.city, 'New York');
    assert.equal(hudson.bundesland, 'NY');
    assert.equal(framing.bundesland, 'NM');
    assert.equal(hudson.relevance_tier, 'Gallery');
    assert.equal(hudson.specialties, 'contemporary');
    assert.equal(framing.relevance_tier, 'Not a buyer', 'until its site shows exhibitions');
    assert.equal(district.relevance_tier, 'Gallery');
    assert.equal(lakeshore.relevance_tier, 'Auction house');
    assert.equal(lakeshore.accepts_consignments, 'yes', 'from the Maps description');
    for (const lead of allLeads) assertContract(lead);
});

test('leads.json: the contract fields on every art lead, the usual fields kept, nothing internal', async () => {
    const usual = ['business_name', 'email', 'other_emails', 'contact_name', 'contact_role', 'phone', 'website', 'city', 'bundesland', 'address',
        'category', 'rating', 'review_count', 'instagram_url', 'maps_description', 'maps_url', 'country', 'country_name', 'campaign', 'observed_date'];
    const contract = ['art_type', 'accepts_submissions', 'submission_url', 'accepts_consignments', 'consign_url', 'specialties',
        'relevance_tier', 'relevance_score', 'relevance_evidence'];
    const row = (name, category, extra, siteText = '', links = []) => {
        const lead = {
            business_name: name, email: '', other_emails: '', contact_name: '', contact_role: '', phone: '', website: '', city: 'New York', bundesland: 'NY',
            address: '548 W 22nd St, New York, NY 10011', category, rating: 4.7, review_count: 80, instagram_url: '', maps_description: '',
            maps_url: `https://www.google.com/maps/place/${encodeURIComponent(name)}`, country: 'US', country_name: 'United States', campaign: 'art',
            observed_date: '2026-11-05', ...extra, _siteText: siteText, _siteLinks: links,
        };
        return Object.assign(lead, relevanceFields(lead, siteText));
    };
    const leads = [
        row('Hudson Line Gallery', 'Art gallery', { email: 'info@hudsonlinegallery.com', phone: '+12125550100', website: 'https://www.hudsonlinegallery.com/' },
            'Submission guidelines. Contemporary photography.', [{ url: 'https://www.hudsonlinegallery.com/artist-submissions', text: 'Artist Submissions' }]),
        row('Lakeshore Auctioneers', 'Auction house', { email: 'info@lakeshoreauctions.com', phone: '+13125550103' }, 'Consign with us.',
            [{ url: 'https://www.lakeshoreauctions.com/consign', text: 'Consign' }]),
        row('Meridian Art Advisory', 'Consultant', { phone: '+12125550104' }),
        row('Frame Masters', 'Picture frame shop', { phone: '+12125550105' }),
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-out-'));
    const save = createSaver(dir, { template: loadTemplate(ART.emailTemplate), whatsappTemplate: loadWhatsAppTemplate(ART.whatsappTemplate),
        includeTiers: ART.includeTiers, workbook: ART.workbook, columns: ART.columns, log: () => {} });
    await save(leads);
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'leads.json'), 'utf8'));
    assert.deepEqual(json.map(r => r.business_name), ['Hudson Line Gallery', 'Lakeshore Auctioneers', 'Meridian Art Advisory', 'Frame Masters']);
    for (const r of json) {
        for (const k of [...usual, ...contract]) assert.ok(k in r, `${r.business_name}: ${k}`);
        assert.ok(!('_siteText' in r) && !('_siteLinks' in r), 'internal fields are not written');
        assertContract(r);
    }
    assert.equal(json[0].submission_url, 'https://www.hudsonlinegallery.com/artist-submissions');
    assert.equal(json[1].consign_url, 'https://www.lakeshoreauctions.com/consign');

    // The workbook and leads.csv show the art columns after Category; the sheets are the usual four.
    assert.ok(fs.existsSync(path.join(dir, 'art-leads.xlsx')));
    assert.ok(!fs.existsSync(path.join(dir, 'judaica-leads.xlsx')));
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(dir, 'art-leads.xlsx'));
    assert.deepEqual(wb.worksheets.map(w => w.name), ['WhatsApp', 'Outreach', 'No email found', 'All results']);
    const header = wb.getWorksheet('All results').getRow(1).values.filter(Boolean);
    assert.deepEqual(header.slice(header.indexOf('Category'), header.indexOf('Category') + 7),
        ['Category', 'Art Type', 'Specialties', 'Submissions', 'Submission Page', 'Consignments', 'Consign Page']);
    const csvHead = fs.readFileSync(path.join(dir, 'leads.csv'), 'utf8').replace(/^﻿/, '').split('\n')[0].split(',');
    assert.ok(csvHead.includes('art_type') && csvHead.includes('consign_url'));
    // Outreach and the mail merge hold the buyers only.
    const csv = fs.readFileSync(path.join(dir, 'mail-merge.csv'), 'utf8');
    assert.match(csv, /info@hudsonlinegallery\.com/);
    assert.match(csv, /info@lakeshoreauctions\.com/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('the art email and WhatsApp message introduce Varnish AI, with an opt-out and nothing invented', () => {
    const t = loadTemplate(ART.emailTemplate);
    const e = renderEmail({ business_name: 'Hudson Line Gallery | Contemporary Art in Chelsea' }, t);
    assert.equal(e.subject, 'Listing Hudson Line Gallery in the Varnish AI directory of art buyers');
    assert.match(e.body, /^Dear Hudson Line Gallery Team,\n\nI'm \[Your Name\] from Varnish AI, a platform that helps people sell artwork/);
    assert.match(e.body, /If you would rather not hear from us again, just reply and let us know, and we will not contact you further\./);
    assert.match(e.body, /\[Your Name\]\n\[Title\]\nVarnish AI\n\[Postal address\]\n$/, 'CAN-SPAM wants a postal address: left for the user to fill in');
    assert.doesNotMatch(e.subject + e.body, /\{\{|Jaffa|Zack|\d{3}[-. )]\d{3}/);
    const named = renderEmail({ business_name: 'Hudson Line Gallery' }, t, { name: 'Dana Levi', title: 'Partnerships' });
    assert.match(named.body, /I'm Dana Levi from Varnish AI/);
    const wa = loadWhatsAppTemplate(ART.whatsappTemplate);
    assert.match(wa, /Varnish AI/);
    assert.match(wa, /won't message you again/);
    assert.doesNotMatch(wa, /Jaffa|Zack|\+\d/);
    const [r] = prepareLeads([place('Hudson Line Gallery', 'Art gallery', { relevance_tier: 'Gallery', phone: '+12125550100' })], { whatsappTemplate: wa, includeTiers: ART.includeTiers });
    assert.match(r.whatsapp_link, /^https:\/\/wa\.me\/12125550100\?text=.*Varnish%20AI/);
});

test('US art "places": cities by state code, as the full run searches them; a city without its state gets it', () => {
    const warnings = [];
    const locs = resolveLocations({ country: 'US', campaign: 'art', places: { FL: ['Miami, FL', 'Tampa'], il: ['Chicago'], US: ['Santa Fe, NM', 'Nowhere'], ZZ: ['Atlantis'] }, districts: true },
        (m) => warnings.push(m));
    // Districts come with a known city (Wynwood, River North, Canyon Road…).
    assert.deepEqual(locs.map(l => `${l.state} ${l.city}`), ['FL Miami, FL', 'FL Tampa, FL', 'IL Chicago, IL', 'NM Santa Fe, NM', 'FL Wynwood, Miami, FL',
        'FL Design District, Miami, FL', 'IL River North, Chicago, IL', 'IL West Loop, Chicago, IL', 'NM Canyon Road, Santa Fe, NM', 'NM Railyard, Santa Fe, NM']);
    // "IL" is Illinois here; "US" places a "City, ST"; a city with no state, and an unknown code, are skipped.
    assert.equal(warnings.length, 2);
    const full = resolveLocations({ country: 'US', campaign: 'art' }, () => {});
    for (const l of locs.filter(x => !/Tampa/.test(x.city))) assert.ok(full.some(f => f.state === l.state && f.city === l.city), `${l.state} ${l.city}`);
});
