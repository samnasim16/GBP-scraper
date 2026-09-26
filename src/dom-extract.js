/**
 * Everything that runs INSIDE the page.
 *
 * Each export is a self-contained function — no imports, no closure over module
 * scope — because puppeteer serialises it and evaluates it in the browser.
 * Keeping them here (rather than inline in the scrape loop) means they can be
 * exercised against saved Google Maps markup with jsdom, which is the only way
 * to catch a selector regression before it costs a run.
 */

/* eslint-env browser */

/**
 * Read every result card in the search feed.
 *
 * The important part is `resolveCard`. The previous implementation used
 * `link.closest('div[jsaction]')`, which resolves to an ancestor containing the
 * WHOLE feed — so every business inherited the first card's rating, review
 * count and category. Here we walk up only while the ancestor still contains a
 * single distinct place link, which bounds each card exactly.
 */
export function extractFeedCards() {
    const PLACE_LINK = 'a[href*="/maps/place/"]';

    const feed = document.querySelector('div[role="feed"]');
    const root = feed || document.body;

    function distinctPlaceLinks(el) {
        const hrefs = new Set();
        for (const a of el.querySelectorAll(PLACE_LINK)) hrefs.add(a.getAttribute('href'));
        return hrefs.size;
    }

    function resolveCard(link) {
        let node = link;
        while (node.parentElement && node.parentElement !== root) {
            if (distinctPlaceLinks(node.parentElement) > 1) break;
            node = node.parentElement;
        }
        return node;
    }

    const anchors = Array.from(root.querySelectorAll(PLACE_LINK));
    const out = [];
    const seenHref = new Set();

    for (const link of anchors) {
        const href = link.href;
        if (!href || seenHref.has(href)) continue;
        seenHref.add(href);

        const card = resolveCard(link);
        const rawTxt = card.textContent || '';
        // A card for a business with no reviews shows its phone number instead
        // of a rating, and "(978) 702-3418" contains "(978)" — which the
        // parenthesised-number fallback below reads as 978 reviews. Strip phone
        // numbers first: a live run put an area code in the review column of
        // 104 leads and scored every one of them on it.
        const txt = rawTxt.replace(/\(\d{3}\)\s*\d{3}[-.\u2013\s]?\d{4}/g, ' ');

        let name = (link.getAttribute('aria-label') || '').trim();
        if (!name) {
            const nameEl = card.querySelector('.qBF1Pd, .fontHeadlineSmall');
            name = nameEl ? nameEl.textContent.trim() : '';
        }
        if (!name) continue;

        // Rating — dedicated span first, then an aria-label, then a bare pattern.
        let rating = null;
        const ratingEl = card.querySelector('.MW4etd');
        if (ratingEl) {
            const rv = parseFloat(ratingEl.textContent);
            if (!isNaN(rv) && rv >= 1 && rv <= 5) rating = rv;
        }
        if (rating === null) {
            const star = card.querySelector('[role="img"][aria-label*="star" i], [aria-label*="star" i]');
            const lab = star ? (star.getAttribute('aria-label') || '') : '';
            const lm = lab.match(/([1-5](?:[.,]\d)?)\s*star/i);
            if (lm) rating = parseFloat(lm[1].replace(',', '.'));
        }
        if (rating === null) {
            const rm = txt.match(/\b([1-5]\.\d)\b/);
            if (rm) rating = parseFloat(rm[1]);
        }

        // Review count.
        let reviewCount = 0;
        const reviewEl = card.querySelector('.UY7F9');
        if (reviewEl) {
            const m = reviewEl.textContent.replace(/[(), ]/g, '').match(/(\d+)/);
            if (m) reviewCount = parseInt(m[1], 10);
        }
        if (reviewCount === 0) {
            const pm = txt.match(/\(([\d,]+)\)/);
            if (pm) reviewCount = parseInt(pm[1].replace(/,/g, ''), 10);
        }
        if (rating === null || reviewCount === 0) {
            const anyLabel = Array.from(card.querySelectorAll('[aria-label]'))
                .map(e => e.getAttribute('aria-label') || '')
                .find(l => /star/i.test(l) && /review/i.test(l));
            if (anyLabel) {
                if (rating === null) {
                    const sm = anyLabel.match(/([1-5](?:\.\d)?)\s*star/i);
                    if (sm) rating = parseFloat(sm[1]);
                }
                if (reviewCount === 0) {
                    const cm = anyLabel.match(/([\d,]+)\s*review/i);
                    if (cm) reviewCount = parseInt(cm[1].replace(/,/g, ''), 10);
                }
            }
        }
        if (rating !== null && (rating < 1 || rating > 5)) rating = null;
        // Google never shows a review count without a rating. If there is no
        // rating, any number we scraped is something else — a phone, a price,
        // an address. Under-reporting beats inventing social proof.
        if (rating === null) reviewCount = 0;

        // Website button — only the real action button counts, never Directions
        // or Call. Evidence is recorded so a drop can be audited.
        let hasWebsite = false;
        let websiteEvidence = '';
        const wbtn = card.querySelector('a[data-value="Website"]');
        if (wbtn) {
            hasWebsite = true;
            websiteEvidence = 'data-value=Website -> ' + (wbtn.href || '(no href)');
        }
        if (!hasWebsite) {
            const wl = Array.from(card.querySelectorAll('a[aria-label]'))
                .find(a => /^visit.*website|^website/i.test(a.getAttribute('aria-label') || ''));
            if (wl) {
                hasWebsite = true;
                websiteEvidence = 'aria-label="' + wl.getAttribute('aria-label') + '" -> ' + (wl.href || '(no href)');
            }
        }

        // Category: first token of a detail row that isn't a rating or a status.
        let category = '';
        for (const row of Array.from(card.querySelectorAll('.W4Efsd'))) {
            const first = (row.textContent || '').split('·')[0].trim();
            if (!first) continue;
            if (/^[\d.,()\s]+$/.test(first)) continue;
            if (/^\d/.test(first)) continue;
            if (/^(open|closed|closes|opens|temporarily|permanently)/i.test(first)) continue;
            category = first;
            break;
        }
        // Strip a status word that got concatenated onto the category, e.g.
        // "Car Detailing ServiceOpen 24 hours".
        category = category.replace(/(Open|Closed|Closes|Opens)(\s|⋅|24|$).*$/i, '').trim();

        out.push({
            name,
            rating,
            reviewCount,
            hasWebsite,
            websiteEvidence,
            category,
            closedFlag: /permanently closed/i.test(rawTxt),
            href,
        });
    }
    return out;
}

/**
 * Read the business detail panel.
 *
 * Everything is scoped to `div[role="main"]`, because the page also renders
 * "People also search for" cards whose ratings and review counts otherwise leak
 * into the wrong business.
 */
export function extractDetail() {
    const panel = document.querySelector('div[role="main"]') || document.body;
    const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

    const isReal = (h) => {
        if (!h || !/^https?:\/\//i.test(h)) return false;
        if (h.includes('/maps/') || h.includes('gstatic.') || h.includes('schema.org')) return false;
        try {
            return !/(^|\.)google\./i.test(new URL(h).hostname);
        } catch (e) {
            return false;
        }
    };

    // ── Name ──────────────────────────────────────────────────────────────
    const h1 = panel.querySelector('h1.DUwDvf') || panel.querySelector('h1');
    const name = clean(h1 && h1.textContent);

    // ── Rating & reviews (header block only) ──────────────────────────────
    let rating = null;
    let reviews = 0;
    const f7 = panel.querySelector('div.F7nice');
    if (f7) {
        const starLab = f7.querySelector('[aria-label*="star" i]');
        if (starLab) {
            const m = (starLab.getAttribute('aria-label') || '').match(/([1-5](?:\.\d)?)/);
            if (m) rating = parseFloat(m[1]);
        }
        const t = f7.textContent || '';
        if (rating === null) {
            const rm = t.match(/([1-5](?:\.\d)?)/);
            if (rm) rating = parseFloat(rm[1]);
        }
        const cm = t.match(/\(([\d,]+)\)/);
        if (cm) reviews = parseInt(cm[1].replace(/,/g, ''), 10);
        if (reviews === 0) {
            const revLab = Array.from(f7.querySelectorAll('[aria-label]'))
                .map(e => e.getAttribute('aria-label') || '')
                .find(l => /review/i.test(l));
            if (revLab) {
                const rc = revLab.match(/([\d,]+)\s*review/i);
                if (rc) reviews = parseInt(rc[1].replace(/,/g, ''), 10);
            }
        }
    }
    if (rating === null || reviews === 0) {
        const lab = Array.from(panel.querySelectorAll('[aria-label]'))
            .map(e => e.getAttribute('aria-label') || '')
            .find(l => /star/i.test(l) && /review/i.test(l));
        if (lab) {
            if (rating === null) {
                const sm = lab.match(/([1-5](?:\.\d)?)\s*star/i);
                if (sm) rating = parseFloat(sm[1]);
            }
            if (reviews === 0) {
                const cm2 = lab.match(/([\d,]+)\s*review/i);
                if (cm2) reviews = parseInt(cm2[1].replace(/,/g, ''), 10);
            }
        }
    }
    if (rating !== null && (rating < 1 || rating > 5)) rating = null;
    if (rating === null) reviews = 0;   // same invariant as the feed

    // ── Category ──────────────────────────────────────────────────────────
    let category = '';
    const catBtn = panel.querySelector('button.DkEaL, [jsaction*="category"]');
    if (catBtn) category = clean(catBtn.textContent);
    if (!category) {
        const catLink = Array.from(panel.querySelectorAll('button, a'))
            .find(el => /^[A-Za-z][A-Za-z /&\-']{2,40}$/.test(clean(el.textContent))
                && !/^(directions|save|nearby|send|share|call|website|order|book|reviews?|overview|about|photos?|updates|menu)$/i.test(clean(el.textContent)));
        if (catLink) category = clean(catLink.textContent);
    }
    category = category.replace(/(Open|Closed|Closes|Opens)(\s|⋅|24|$).*$/i, '').trim();

    // ── Phone ─────────────────────────────────────────────────────────────
    // International, German-first. Maps gives "phone:tel:+4930123456" on most
    // listings, but some carry the national form "030 123456" — a leading 0 is
    // a German trunk prefix and becomes +49. Anything that already has a
    // country code (+ or 00) is kept as-is, so an Austrian or Swiss shop that
    // turns up near the border is not rewritten into a German number.
    const normPhone = (raw) => {
        const s = String(raw || '').trim();
        let d = s.replace(/\D/g, '');
        if (!d) return null;
        if (/^\+/.test(s)) { /* already international */ }
        else if (d.startsWith('00')) d = d.slice(2);
        else if (d.startsWith('0')) d = '49' + d.slice(1);
        else if (d.length === 10 && !d.startsWith('49')) d = '1' + d;   // bare US number
        if (d.length < 8 || d.length > 15) return null;
        return '+' + d;
    };
    let phone = null;
    for (const el of panel.querySelectorAll('[data-item-id^="phone:tel:"]')) {
        phone = normPhone((el.getAttribute('data-item-id') || '').replace('phone:tel:', ''));
        if (phone) break;
    }
    if (!phone) {
        const tel = panel.querySelector('a[href^="tel:"]');
        if (tel) phone = normPhone(tel.getAttribute('href').replace('tel:', ''));
    }
    if (!phone) {
        for (const el of panel.querySelectorAll('[aria-label]')) {
            const label = el.getAttribute('aria-label') || '';
            if (!/phone|telefon/i.test(label)) continue;
            const m = label.match(/\+?[\d][\d\s()./-]{6,}\d/);
            if (m) { phone = normPhone(m[0]); if (phone) break; }
        }
    }

    // ── Website status ────────────────────────────────────────────────────
    // 'Website visible' | 'No visible Website button' | 'Unknown'
    let websiteStatus = 'Unknown';
    let websiteUrl = '';
    const authority = panel.querySelector('a[data-item-id="authority"]');
    if (authority && isReal(authority.href)) {
        websiteStatus = 'Website visible';
        websiteUrl = authority.href;
    }
    if (websiteStatus === 'Unknown') {
        const labelled = Array.from(panel.querySelectorAll('a[aria-label], a[data-tooltip]'))
            .find(a => {
                const lab = a.getAttribute('aria-label') || a.getAttribute('data-tooltip') || '';
                return /website|webseite|visit.*site/i.test(lab) && isReal(a.href);
            });
        if (labelled) { websiteStatus = 'Website visible'; websiteUrl = labelled.href; }
    }
    if (websiteStatus === 'Unknown') {
        const action = Array.from(panel.querySelectorAll('a'))
            .find(a => /^website$/i.test(clean(a.textContent)) && isReal(a.href));
        if (action) { websiteStatus = 'Website visible'; websiteUrl = action.href; }
    }
    if (websiteStatus === 'Unknown') {
        // Google only offers "Add website" when the business has not supplied one.
        const addPrompt = Array.from(panel.querySelectorAll('a, button, span, div'))
            .some(el => /^(add website|website hinzufügen)$/i.test(clean(el.textContent)));
        if (addPrompt) websiteStatus = 'No visible Website button';
    }

    // ── Social links present on the listing itself ────────────────────────
    const socialUrls = [];
    for (const a of panel.querySelectorAll('a[href]')) {
        const h = a.href || '';
        if (/facebook\.com|instagram\.com|tiktok\.com|linkedin\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|yelp\.com|nextdoor\.com/i.test(h)) {
            socialUrls.push(h);
        }
    }

    // ── Description / editorial summary ───────────────────────────────────
    let description = '';
    for (const s of ['.PYvSYb', '.WeS02d .PYvSYb', '[data-attrid="description"]', '.HlvSq .PYvSYb']) {
        const el = panel.querySelector(s);
        if (el && clean(el.textContent).length > 20) { description = clean(el.textContent); break; }
    }

    // ── Hours ─────────────────────────────────────────────────────────────
    let hasHours = 'No';
    let hoursSummary = '';
    // Best source: the collapsed hours row carries the whole week in aria-label.
    const weekEl = panel.querySelector('.t39EBf[aria-label], [aria-label*="Sunday" i][aria-label*="Monday" i]');
    if (weekEl) {
        const lab = clean(weekEl.getAttribute('aria-label'))
            .replace(/;?\s*(Hide|Show) open hours for the week\.?$/i, '')
            .replace(/\s*Hours might differ/gi, '')
            .replace(/;\s*$/, '');
        if (/\d/.test(lab)) { hoursSummary = lab; hasHours = 'Yes'; }
    }
    if (!hoursSummary) {
        const rows = Array.from(panel.querySelectorAll('table tr'))
            .map(tr => {
                const cells = Array.from(tr.querySelectorAll('td, th')).map(td => clean(td.textContent));
                return cells.filter(Boolean).join(' ');
            })
            .filter(r => /(mon|tue|wed|thu|fri|sat|sun)/i.test(r) && /(\d|closed|open 24)/i.test(r));
        if (rows.length) { hoursSummary = rows.join('; '); hasHours = 'Yes'; }
    }
    if (!hoursSummary) {
        const statusEl = panel.querySelector('.ZDu9vd, span.o0Svhf, [aria-label*="Open" i][aria-label*="Close" i]');
        const st = clean(statusEl && (statusEl.getAttribute('aria-label') || statusEl.textContent));
        // "Hours" on its own is the button label, not information.
        if (st && !/^hours$/i.test(st) && st.length > 3) {
            hoursSummary = st;
            hasHours = /open|close|24 hours/i.test(st) ? 'Yes' : 'No';
        }
    }
    if (hasHours === 'No' && panel.querySelector('[data-item-id="oh"]')) hasHours = 'Yes';
    if (/^hours$/i.test(hoursSummary)) hoursSummary = '';

    // ── Price level ───────────────────────────────────────────────────────
    let priceLevel = '';
    const priceLabelled = Array.from(panel.querySelectorAll('[aria-label]'))
        .find(e => /^price[: ]/i.test(e.getAttribute('aria-label') || ''));
    if (priceLabelled) {
        priceLevel = clean(priceLabelled.getAttribute('aria-label')).replace(/^price:?\s*/i, '');
    }
    if (!priceLevel) {
        const dollar = Array.from(panel.querySelectorAll('span'))
            .map(e => clean(e.textContent))
            .find(t => /^\${1,4}$/.test(t) || /^\$\d+[–-]\$?\d+$/.test(t));
        if (dollar) priceLevel = dollar;
    }

    // ── Email & booking ───────────────────────────────────────────────────
    let email = '';
    const mail = panel.querySelector('a[href^="mailto:"]');
    if (mail) email = mail.getAttribute('href').replace('mailto:', '').split('?')[0];

    let bookingLink = '';
    const BOOKING_WORDS = /\b(book|booking|appointment|appointments|reserve|reservation|schedule|scheduling)\b/i;
    const SOCIAL_HOST = /facebook\.com|instagram\.com|tiktok\.com|linkedin\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|yelp\.com|nextdoor\.com/i;
    const book = Array.from(panel.querySelectorAll('a[href]'))
        .find(a => BOOKING_WORDS.test((a.getAttribute('aria-label') || '') + ' ' + (a.textContent || ''))
            && isReal(a.href)
            && !SOCIAL_HOST.test(a.href));
    if (book) bookingLink = book.href.split('?')[0];

    // ── Address / service area ────────────────────────────────────────────
    let address = '';
    const addrEl = panel.querySelector('[data-item-id="address"] .Io6YTe')
        || panel.querySelector('[data-item-id="address"]');
    if (addrEl) {
        address = clean(addrEl.textContent) || clean(addrEl.getAttribute('aria-label')).replace(/^address:?\s*/i, '');
    }
    if (!address) {
        const serves = Array.from(panel.querySelectorAll('div, span'))
            .map(e => clean(e.textContent))
            .find(t => /^serves .{3,80}$/i.test(t));
        if (serves) address = serves;
    }

    const hasPhotos = !!panel.querySelector('button[aria-label*="photo" i]');

    return {
        name, rating, reviews, category, phone,
        websiteStatus, websiteUrl, socialUrls,
        description, hasHours, hoursSummary, priceLevel,
        email, bookingLink, address, hasPhotos,
    };
}
