/**
 * Getting a browser to drive.
 *
 * Two modes:
 *   local        — launch Chrome on this machine. Free. Google Maps generally
 *                  tolerates a residential IP, which is what makes this viable.
 *   brightdata   — connect to a remote Scraping Browser over WSS. Costs money,
 *                  but survives datacenter IPs and heavy blocking.
 *
 * Default is `auto`: use Bright Data only if an endpoint was configured,
 * otherwise run locally. Nothing about this project requires Bright Data.
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

const DESKTOP_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MAC_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Where Chrome actually lives, per platform. First hit wins. */
function candidateChromePaths() {
    const home = os.homedir();
    const env = [
        process.env.CHROME_PATH,
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.PLAYWRIGHT_BROWSERS_PATH
            ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium')
            : null,
    ];

    if (process.platform === 'darwin') {
        return [...env,
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        ];
    }
    if (process.platform === 'win32') {
        const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
        const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
        const local = process.env['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local');
        return [...env,
            path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
            path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
            path.join(pf, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
        ];
    }
    return [...env,
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        '/usr/bin/microsoft-edge',
        '/usr/bin/brave-browser',
        '/opt/google/chrome/chrome',
    ];
}

/**
 * Find a usable Chrome. Explicit config wins, then the environment, then the
 * usual install locations, then puppeteer's own bundled download if the full
 * `puppeteer` package happens to be installed alongside puppeteer-core.
 */
export async function resolveChromePath(configuredPath) {
    if (configuredPath) {
        if (fs.existsSync(configuredPath)) return configuredPath;
        throw new Error(`chromePath does not exist: ${configuredPath}`);
    }
    for (const p of candidateChromePaths()) {
        if (p && fs.existsSync(p)) return p;
    }
    // Optional: the full puppeteer package bundles its own Chromium.
    try {
        const full = await import('puppeteer');
        const exe = (full.default || full).executablePath();
        if (exe && fs.existsSync(exe)) return exe;
    } catch { /* not installed — that's the normal case */ }
    return null;
}

const NO_CHROME_MESSAGE = `
❌ COULD NOT FIND CHROME ON THIS MACHINE.

   This scraper drives a real Chrome. Pick one:

   1. Install Google Chrome (easiest)      https://www.google.com/chrome/
   2. Point at an existing browser:
        "browser": { "chromePath": "/full/path/to/chrome" }   in input.json
        or set CHROME_PATH=/full/path/to/chrome
   3. Let npm fetch a private copy:
        npm install puppeteer
`;

/**
 * Does this error mean the page or browser is gone, rather than the page
 * simply failing to load? A dead session poisons every later query, so it must
 * trigger a reopen immediately instead of being counted as an ordinary failure.
 */
export function isSessionDead(err) {
    const msg = (err && err.message) ? err.message : String(err || '');
    return /detached Frame|Session closed|Target closed|Protocol error|Connection closed|Navigating frame was detached|browser has disconnected|Requesting main frame too early/i.test(msg);
}

export const DEFAULT_BROWSER_CONFIG = {
    mode: 'auto',              // 'auto' | 'local' | 'brightdata'
    headless: true,
    chromePath: '',
    userDataDir: '.cache/chrome-profile',
    slowMo: 0,
    proxyServer: '',           // optional http(s) proxy for the local browser
    windowSize: { width: 1280, height: 900 },
};

/**
 * Build the thing that opens browser sessions.
 *
 * @returns {Promise<{mode:string, describe:string, open:Function, refresh:Function, close:Function}>}
 */
export async function createBrowserFactory({ config = {}, wssEndpoint = '', log = console.log } = {}) {
    const cfg = { ...DEFAULT_BROWSER_CONFIG, ...config };
    const wants = String(cfg.mode || 'auto').toLowerCase();

    let mode;
    if (wants === 'brightdata') {
        if (!wssEndpoint) {
            throw new Error('browser.mode is "brightdata" but no BRIGHTDATA_WSS / browserWSEndpoint was provided');
        }
        mode = 'brightdata';
    } else if (wants === 'local') {
        mode = 'local';
    } else {
        mode = wssEndpoint ? 'brightdata' : 'local';
    }

    if (mode === 'brightdata' && !wssEndpoint.startsWith('wss://')) {
        throw new Error('Invalid Bright Data endpoint: it must start with "wss://"');
    }

    let chromePath = null;
    if (mode === 'local') {
        chromePath = await resolveChromePath(cfg.chromePath);
        if (!chromePath) {
            console.error(NO_CHROME_MESSAGE);
            throw new Error('No Chrome executable found');
        }
    }

    const userAgent = process.platform === 'darwin' ? MAC_UA : DESKTOP_UA;

    async function configurePage(page) {
        page.on('error', () => {});
        page.on('pageerror', () => {});
        await page.setUserAgent(userAgent);
        await page.setViewport({ width: cfg.windowSize.width, height: cfg.windowSize.height });
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        return page;
    }

    async function launchLocal() {
        const args = [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-features=Translate,MediaRouter',
            '--hide-crash-restore-bubble',
            '--disable-session-crashed-bubble',
            '--disable-infobars',
            '--password-store=basic',
            '--no-service-autorun',
            '--lang=en-US',
            `--window-size=${cfg.windowSize.width},${cfg.windowSize.height}`,
        ];
        // Running as root (containers, some VMs) needs the sandbox relaxed.
        if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
            args.push('--no-sandbox', '--disable-setuid-sandbox');
        }
        if (cfg.proxyServer) args.push(`--proxy-server=${cfg.proxyServer}`);

        const launchOpts = {
            executablePath: chromePath,
            headless: cfg.headless === false ? false : true,
            args,
            slowMo: cfg.slowMo || 0,
            defaultViewport: null,
        };
        // A persistent profile keeps Google's consent choice between runs,
        // which is the difference between hitting the cookie wall every query
        // and hitting it once.
        if (cfg.userDataDir) {
            const dir = path.resolve(process.cwd(), cfg.userDataDir);
            fs.mkdirSync(dir, { recursive: true });
            launchOpts.userDataDir = dir;
        }
        try {
            return await puppeteer.launch(launchOpts);
        } catch (e) {
            // Headful needs a display; on a server or container there isn't one.
            if (/X server|DISPLAY|cannot open display|platform failed to initialize|aura/i.test(e.message)) {
                throw new Error(
                    `Chrome could not open a window (no display available). ` +
                    `Set "browser": { "headless": true } in input.json, or run on a desktop session. [${e.message}]`
                );
            }
            // Any failure to launch WITH a profile is worth one retry without
            // one. The usual cause is the profile being in use — by another run
            // or one that was killed — but Windows reports that as a dialog
            // rather than on stderr, so puppeteer just says "Failed to launch
            // the browser process! undefined". Matching on the message was
            // never going to be reliable; retrying is.
            if (launchOpts.userDataDir) {
                log(`   ⚠️  Chrome would not start with profile ${launchOpts.userDataDir}: ${e.message.split('\n')[0]}`);
                log('      Retrying with a temporary profile — you may see the cookie prompt again.');
                const { userDataDir, ...withoutProfile } = launchOpts;
                void userDataDir;
                return puppeteer.launch(withoutProfile);
            }
            throw e;
        }
    }

    async function open() {
        const browser = mode === 'local'
            ? await launchLocal()
            : await puppeteer.connect({ browserWSEndpoint: wssEndpoint });

        browser.on('disconnected', () => {});
        if (typeof browser.process === 'function') {
            const proc = browser.process();
            if (proc) proc.on('error', () => {});
        }

        // Always create our own tab rather than adopting the one Chrome opens
        // at startup. With a persistent profile Chrome may replace or discard
        // that initial tab (session restore, first-run UI, the "restore pages?"
        // bubble), which detaches the frame and leaves every later navigation
        // failing with "Attempted to use detached Frame".
        const page = await browser.newPage();
        await configurePage(page);

        // Tidy up the startup tab so headful runs don't show a stray window.
        if (mode === 'local') {
            try {
                for (const other of await browser.pages()) {
                    if (other === page) continue;
                    const url = other.url();
                    if (!url || url === 'about:blank' || url.startsWith('chrome://')) {
                        await other.close().catch(() => {});
                    }
                }
            } catch { /* tidying is best-effort */ }
        }
        return { browser, page };
    }

    /**
     * Periodic hygiene between batches of queries.
     * Remote sessions must be fully re-established to rotate the proxy exit
     * node; a local browser only needs a clean tab, so relaunching it would be
     * pure overhead.
     */
    async function refresh(session) {
        if (mode === 'brightdata') {
            try { await session.browser.close(); } catch { /* already gone */ }
            return open();
        }
        try {
            const fresh = await session.browser.newPage();
            await configurePage(fresh);
            try { await session.page.close(); } catch { /* already closed */ }
            return { browser: session.browser, page: fresh };
        } catch {
            // The browser itself died — start over.
            try { await session.browser.close(); } catch { /* ignore */ }
            return open();
        }
    }

    async function close(session) {
        if (!session || !session.browser) return;
        try { await session.browser.close(); } catch { /* already gone */ }
    }

    const describe = mode === 'local'
        ? `local Chrome (${chromePath}${cfg.headless === false ? ', headful' : ''})`
        : 'Bright Data Scraping Browser';

    log(`🌐 Browser: ${describe}`);
    return { mode, describe, open, refresh, close, chromePath };
}
