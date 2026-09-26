# CLAUDE.md — project guide for Claude Code

## What this project is

A Node.js scraper that finds **Judaica retailers across Germany** on Google Maps for **Jaffa Glass** (Israeli maker of hand-crafted kosher glass Judaica with 24-karat gold paint). For each place, it reads the shop's website and **Impressum** to get an email address and a named contact. It scores how likely the place is to stock Judaica, then writes a spreadsheet and a mail-merge CSV with the partnership email rendered for each shop.

It is adapted from the archived *no-website lead scraper*, which found US businesses without websites. That project's browser handling (`browser.js`), in-page extractors (`dom-extract.js`) and HTTP transport (`http.js`) were kept, along with their tests. The US social-profile enrichment was replaced with website/Impressum contact extraction. The main difference in purpose: **here we want shops that do have a website**, because the website is where the email comes from.

Nothing costs money by default. Don't add a hard dependency on a paid service.

## Run

```bash
npm install
cp input.example.json input.json     # Windows: copy input.example.json input.json
npm run smoke                        # Berlin, 2 terms, 10 places, visible browser → output-smoke/
npm start                            # all of Germany → output/
npm run contacts -- --probe https://shop.de "Shop Name"
npm run contacts -- output/leads.json
npm test                             # 56 tests, offline; browser tests skip without Chrome
```

Use `--input path.json`, not `INPUT_FILE=`, because the env-var form fails silently in cmd.exe.

## Layout

```
src/
  main.js           orchestration: query loop, session hygiene, saving, summary
  config.js         GERMAN_CITIES (by Bundesland), CITY_DISTRICTS, DEFAULT_CATEGORIES, query matrix
  maps.js           one Maps query: consent → feed → detail pages → lead rows
  dom-extract.js    functions that run INSIDE the page (self-contained, serialised by puppeteer)
  relevance.js      Judaica keyword scoring → tier
  contacts.js       email extraction/ranking, Impressum name, greeting, link discovery, worker pool
  email-template.js loads templates/partnership-email.txt and fills {{placeholders}}
  output.js         dedupe, sort, xlsx (Outreach / No email found / All results), mail-merge.csv
  contacts-cli.js   re-run contact lookup on an export; --probe one site
  browser.js        local Chrome launch / optional Bright Data
  http.js           direct fetch with a browser fallback
templates/partnership-email.txt   the outreach email (first line "Subject: …")
test/               node:test + jsdom; fixtures/ has Maps markup and a fake German shop site
```

## Decisions that are load-bearing

- **Maps is loaded with `?hl=en&gl=de`**: German results with an English UI. The extractors read English labels (`stars`, `reviews`, `Add website`). Supporting one UI language is much easier than supporting two. Don't drop `hl=en` without also teaching `dom-extract.js` German labels, and prove it with a fixture.
- **EU consent redirect.** From an EU IP, Maps first redirects to `consent.google.com`. `passConsent` answers it. `detectBlockPage` must **not** treat consent as a block (the US original did).
- **Phones are international.** `normPhone` in `dom-extract.js` turns `030 …` into `+4930…`, keeps anything that already has `+`/`00`, and never rewrites an Austrian or Swiss number as German.
- **Foreign results are dropped** by address suffix (`FOREIGN_ADDRESS` in `maps.js`). Border-city searches return Austrian, Swiss, French and Dutch shops.
- **Relevance matches at word starts only** (`countHits` in `relevance.js`). A bare substring test finds "tora" in "Restaurierung". Glass words match anywhere because of compounds like "Kunstglas" and "Bleiglas". A category in `NON_RETAIL_CATEGORY` (restaurant, café, cemetery, glazier…) caps the score unless the *name* carries a strong Judaica word.
- **Only sellable businesses are kept** (`isSellable` in `relevance.js`). A non-profit / religious Maps category (synagogue, community, non-profit, institute, school, library, museum…) or name (e.V., Gemeinde, Chabad, Stiftung, Verein…) drops the place at the feed stage and again on the detail page, before its website is read. A retail category (store, shop, gallery…) overrides a non-profit-sounding name, so a Chabad-run Judaica store survives. A Judaica word in the name overrides a wrong non-profit category ("Judaica Direct" filed as *Public Library*). Retail evidence for the tiers comes from the listing only, never the website, because every community site links to a shop page. `keepNonProfits: true` turns the filter off.
- **Email ranking** (`rankEmails`): +40 for the site's own domain, +20 when the domain spells the business name, +15 for freemail, +10 for info/kontakt/shop prefixes, −30 for datenschutz/noreply/jobs, −25 for agency-looking domains. Web designers put their own address in the footer, and it must never win.
- **Greeting gender only from evidence** (`greetingFor`): Frau/Herr or Inhaberin/Inhaber/Geschäftsführerin. Otherwise use the full name. Never guess gender from a first name.
- **Impressum name extraction** stops at the first word that is a company form, a street (compound suffix `…straße`), a digit or the next field label. A company alone (`Vertreten durch: X GmbH`) yields no name, which is correct.

## Recipes

- **Add cities:** edit `GERMAN_CITIES` / `CITY_DISTRICTS` in `src/config.js`.
- **Add search terms:** `DEFAULT_CATEGORIES`. Put strong ones in `HIGH_YIELD` so they run across every city first.
- **Tune relevance:** edit the word lists in `src/relevance.js` and add a case to `test/pipeline.test.js`.
- **A Maps column goes blank:** save the page HTML into `test/fixtures/`, write a failing test in `test/dom-extract.test.js`, then fix the selector.
- **A shop's email is missed:** `npm run contacts -- --probe <url> "<name>"`. If the email is on a page that isn't linked, add the path to `guessContactUrls`. If it is obfuscated in a new way, extend `deobfuscate` and add a test.
