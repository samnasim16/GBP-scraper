/**
 * Fetching pages for enrichment.
 *
 * Two transports:
 *   local   — Node's built-in fetch, straight out of the machine running the
 *             scraper. Costs nothing.
 *   browser — a throwaway tab on the Bright Data remote browser. Costs Bright
 *             Data traffic, so it is a fallback, not the default.
 *
 * `auto` starts local and switches to browser once local is clearly being
 * blocked, retrying local occasionally in case the block was temporary.
 * That keeps a large run cheap while still finishing if the home IP gets
 * rate-limited halfway through.
 */

const DESKTOP_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
    'User-Agent': DESKTOP_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
};

export function createHttpClient({
    transport = 'auto',
    getBrowser = null,
    timeoutMs = 20000,
    localFailureThreshold = 4,
    localRetryEvery = 25,
    localRetryMax = 800,
    log = () => {},
} = {}) {
    const state = {
        mode: transport === 'auto' ? 'local' : transport,
        localFailures: 0,
        sinceLocalRetry: 0,
        // How many browser fetches before probing the direct path again. It
        // doubles on every failed probe: DuckDuckGo refuses direct requests
        // structurally, so a fixed interval spends four challenged requests
        // every 25 forever — and those failures are what trip the enricher's
        // circuit breaker. A live run logged 256 blocked of 672 searches while
        // flipping transport twenty times.
        retryEvery: localRetryEvery,
        counts: { local: 0, browser: 0, failed: 0 },
    };

    async function fetchLocal(url, headers) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(url, {
                redirect: 'follow',
                signal: ctrl.signal,
                headers: { ...DEFAULT_HEADERS, ...headers },
            });
            const body = await res.text();
            return { ok: res.ok, status: res.status, body, via: 'local' };
        } finally {
            clearTimeout(timer);
        }
    }

    async function fetchBrowser(url) {
        if (typeof getBrowser !== 'function') throw new Error('no browser available');
        const browser = await getBrowser();
        if (!browser) throw new Error('no browser available');
        let page;
        try {
            page = await browser.newPage();
            page.on('error', () => {});
            page.on('pageerror', () => {});
            await page.setUserAgent(DESKTOP_UA);
            // Enrichment only needs markup — skipping images/fonts/media cuts
            // Bright Data traffic (and therefore cost) substantially.
            try {
                await page.setRequestInterception(true);
                page.on('request', req => {
                    const type = req.resourceType();
                    if (type === 'image' || type === 'media' || type === 'font' || type === 'stylesheet') {
                        req.abort().catch(() => {});
                    } else {
                        req.continue().catch(() => {});
                    }
                });
            } catch { /* interception unsupported — proceed without it */ }

            const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

            // Google shows a consent wall on a fresh profile, and nothing loads
            // behind it. The scraper handles this for Maps; enrichment runs in
            // its own profile, so it meets the wall too.
            try {
                const consent = await page.$('button[aria-label*="Accept all" i], button[aria-label*="Reject all" i], form[action*="consent"] button');
                if (consent) {
                    await consent.click();
                    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
                }
            } catch { /* no consent wall */ }

            // Search results are rendered by JavaScript: Google and DuckDuckGo
            // both return a shell at domcontentloaded, which is why a 484KB
            // Google response once yielded zero links. Wait for outbound links
            // to actually appear — engine-agnostic, since every results page
            // links somewhere other than itself.
            try {
                await page.waitForFunction(() => {
                    const here = location.hostname.replace(/^www\./, '');
                    let outbound = 0;
                    for (const a of document.querySelectorAll('a[href^="http"]')) {
                        try {
                            const h = new URL(a.href).hostname.replace(/^www\./, '');
                            if (h !== here && !h.endsWith('.' + here)) outbound++;
                        } catch { /* skip unparseable */ }
                        if (outbound > 3) return true;
                    }
                    return false;
                }, { timeout: Math.min(12000, timeoutMs), polling: 400 });
            } catch { /* take whatever rendered rather than nothing */ }

            const body = await page.content();
            return { ok: true, status: res ? res.status() : 200, body, via: 'browser' };
        } finally {
            if (page) { try { await page.close(); } catch { /* already gone */ } }
        }
    }

    /**
     * Fetch a URL as text. Never throws — failures come back as {ok:false}.
     * @returns {Promise<{ok:boolean,status:number,body:string,via:string,error?:string}>}
     */
    let lastLocalError = '';

    async function fetchText(url, { headers = {} } = {}) {
        const wantsAuto = transport === 'auto';

        // Periodically give the free path another chance after a switch.
        if (wantsAuto && state.mode === 'browser' && ++state.sinceLocalRetry >= state.retryEvery) {
            state.sinceLocalRetry = 0;
            state.mode = 'local';
            state.localFailures = 0;
            log('   ↩︎  retrying direct requests');
        }

        if (state.mode === 'local') {
            try {
                const r = await fetchLocal(url, headers);
                if (r.ok) {
                    state.localFailures = 0;
                    state.counts.local++;
                    return r;
                }
                // 4xx/5xx from the engine counts as a block signal.
                state.localFailures++;
                if (!wantsAuto) { state.counts.failed++; return r; }
            } catch (e) {
                state.localFailures++;
                lastLocalError = e.message;
                if (!wantsAuto) {
                    state.counts.failed++;
                    return { ok: false, status: 0, body: '', via: 'local', error: e.message };
                }
            }
            if (wantsAuto && state.localFailures >= localFailureThreshold && typeof getBrowser === 'function') {
                state.retryEvery = Math.min(state.retryEvery * 2, localRetryMax);
                state.mode = 'browser';
                state.sinceLocalRetry = 0;
                log(`   🔀 direct requests failing (${state.localFailures}×) — switching enrichment to the browser`);
                // Clear the count with the switch. Leaving it set meant the next
                // probe's first failure logged "(5×)" straight after "(4×)" — the
                // same condition announced twice.
                state.localFailures = 0;
            } else if (wantsAuto) {
                state.counts.failed++;
                return { ok: false, status: 0, body: '', via: 'local', error: lastLocalError || 'local fetch failed' };
            }
        }

        try {
            const r = await fetchBrowser(url);
            state.counts.browser++;
            return r;
        } catch (e) {
            // If there is no browser to be had, going back to direct requests
            // is far better than failing every remaining fetch. Weak results
            // beat none, and descriptions still get generated.
            if (/no browser available/i.test(e.message) && state.mode === 'browser') {
                if (!state.revertedToLocal) {
                    state.revertedToLocal = true;
                    log('   ↩︎  no browser available for enrichment — continuing with direct requests');
                }
                state.mode = 'local';
                state.localFailures = 0;
                try {
                    const r = await fetchLocal(url, headers);
                    if (r.ok) { state.counts.local++; return r; }
                    state.counts.failed++;
                    return r;
                } catch (localErr) {
                    state.counts.failed++;
                    return { ok: false, status: 0, body: '', via: 'local', error: localErr.message };
                }
            }
            state.counts.failed++;
            return { ok: false, status: 0, body: '', via: 'browser', error: e.message };
        }
    }

    /**
     * Report a response that arrived with a success status but was useless —
     * a bot challenge, an interstitial, a page with no results in it.
     *
     * Without this the auto transport never falls back: DuckDuckGo answers a
     * challenge with HTTP 202 and a body containing no links at all, `res.ok`
     * is true, and the client goes on believing the free path works while
     * every search silently returns nothing.
     */
    function markUnusable() {
        if (state.mode !== 'local') return;
        state.localFailures++;
        state.counts.local = Math.max(0, state.counts.local - 1);
        state.counts.unusable = (state.counts.unusable || 0) + 1;
        if (transport === 'auto'
            && state.localFailures >= localFailureThreshold
            && typeof getBrowser === 'function') {
            state.mode = 'browser';
            state.sinceLocalRetry = 0;
            state.retryEvery = Math.min(state.retryEvery * 2, localRetryMax);
            log(`   🔀 search engines are blocking direct requests (${state.localFailures}× challenged) — switching enrichment to the browser`);
        }
    }

    /**
     * Switch to the browser deliberately, for a reason the HTTP layer cannot
     * see — engines that answer 200 with results that are useless. Returns
     * false when there is no browser to switch to.
     */
    function forceBrowser(reason) {
        if (typeof getBrowser !== 'function') return false;
        if (state.revertedToLocal) return false;   // already established there isn't one
        if (state.mode === 'browser') return true;
        state.mode = 'browser';
        state.sinceLocalRetry = 0;
        state.localFailures = 0;
        // Back off the probe here too. This escalation means the direct path
        // answered but the answers were useless, which is exactly what probing
        // it again will produce — a live run flipped transport twenty times
        // because only the "challenged" path backed off, and each flip spent
        // four challenged requests that fed the enricher's circuit breaker.
        state.retryEvery = Math.min(state.retryEvery * 2, localRetryMax);
        log(`   🔀 ${reason} — switching enrichment to the browser`);
        return true;
    }

    /**
     * The direct path just returned results that were actually about the
     * business. That — not a bare HTTP 200 — is what earns eager probing
     * again: a 200 carrying a competitor's page is the very thing
     * `forceBrowser` exists to escape, so resetting on `res.ok` undid the
     * backoff on the next request.
     */
    function markUsable() {
        if (state.mode !== 'local') return;
        state.localFailures = 0;
        state.retryEvery = localRetryEvery;
    }

    return {
        fetchText,
        markUnusable,
        markUsable,
        forceBrowser,
        get mode() { return state.mode; },
        // Diagnostics: how far the direct-path probe has backed off, and how
        // many consecutive direct failures stand behind it.
        get retryEvery() { return state.retryEvery; },
        get localFailures() { return state.localFailures; },
        stats: () => ({ ...state.counts, mode: state.mode }),
    };
}
