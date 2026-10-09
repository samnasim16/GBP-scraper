# CLAUDE.md — project guide for Claude Code

## What this project is

A Node.js scraper that finds **Judaica retailers across Germany, England, France or Belgium** on Google Maps for **Jaffa Glass** (Israeli maker of hand-crafted kosher glass Judaica with 24-karat gold paint). For each place, it reads the shop's website and **Impressum** to get an email address and a named contact. It scores how likely the place is to stock Judaica, then writes a spreadsheet and a mail-merge CSV with the partnership email rendered for each shop.

It is adapted from the archived *no-website lead scraper*, which found US businesses without websites. That project's browser handling (`browser.js`), in-page extractors (`dom-extract.js`) and HTTP transport (`http.js`) were kept, along with their tests. The US social-profile enrichment was replaced with website/Impressum contact extraction. The main difference in purpose: **here we want shops that do have a website**, because the website is where the email comes from.

Nothing costs money by default. Don't add a hard dependency on a paid service.

## Run

```bash
npm install
cp input.example.json input.json     # Windows: copy input.example.json input.json
npm run smoke                        # Berlin, 2 terms, 10 places, visible browser → output-smoke/
npm start                            # all of Germany → output/
npm run smoke:england                # London, 2 terms, 10 places → output-uk-smoke/
npm run england                      # all of England → output-uk/ (input.england.json)
npm run smoke:france / npm run france       # → output-fr-smoke/ / output-fr/   (input.france.json)
npm run smoke:belgium / npm run belgium     # → output-be-smoke/ / output-be/   (input.belgium.json)
npm run contacts -- --probe https://shop.de "Shop Name"
npm run contacts -- output/leads.json
npm test                             # 96 tests, offline; browser tests skip without Chrome
```

Use `--input path.json`, not `INPUT_FILE=`, because the env-var form fails silently in cmd.exe.

## Layout

```
src/
  main.js           orchestration: query loop, session hygiene, saving, summary
  config.js         COUNTRIES (DE, UK, FR, BE): cities by region, districts, search terms, phone code, output dir; query matrix
  maps.js           one Maps query: consent → feed → detail pages → lead rows
  dom-extract.js    functions that run INSIDE the page (self-contained, serialised by puppeteer)
  relevance.js      Judaica keyword scoring → tier
  contacts.js       email extraction/ranking, Impressum name, greeting, link discovery, worker pool
  email-template.js loads templates/partnership-email.txt and fills {{placeholders}}
  output.js         dedupe, sort, xlsx (Outreach / No email found / All results), mail-merge.csv
  contacts-cli.js   re-run contact lookup on an export; --probe one site
  resume.js         continue a stopped run: load saved places, progress.json, --fresh backup
  whatsapp.js       WhatsApp evidence (site/listing links, mentions, mobile ranges), status, priority, wa.me chat link
templates/whatsapp-message.txt    the WhatsApp intro, prefilled in each chat link (never sent automatically)
  browser.js        local Chrome launch / optional Bright Data
  http.js           direct fetch with a browser fallback
templates/partnership-email.txt   the outreach email (first line "Subject: …")
test/               node:test + jsdom; fixtures/ has Maps markup and a fake German shop site
```

## Decisions that are load-bearing

- **One codebase, one profile per market** (`COUNTRIES` in `config.js`, chosen by `"country"` in the input file; default `DE`). A profile carries the Maps `gl`, the phone trunk code, the foreign-address filter, the search terms, the contact-page conventions (`contactKeyPage`/`contactPaths`: Impressum in Germany, Contact page in England) and a default output folder, so one market's run never overwrites another's. To add a market, add a profile and test it the way `test/england.test.js` does; don't branch on the country inside the code.

- **WhatsApp is evidence-based, never probed** (`whatsapp.js`). There is no free, permitted way to ask WhatsApp whether a number is registered, and automating WhatsApp Web to check breaks its terms and risks the user's account. So the status comes from what the shop publishes: a wa.me / api.whatsapp.com link or a number written next to "WhatsApp" on its site (`extractWhatsApp`, run inside the contact lookup) or on its Maps listing (`whatsappUrls` in `dom-extract.js`) gives **Yes** and the WhatsApp number itself; a bare mention or a mobile range gives **Likely**; a landline gives **Check**, because WhatsApp Business runs on landlines (21 of 34 hand-verified England shops were landlines). A `whatsapp_verified` value (yes/no) set by hand always wins. Every row gets a `wa.me/<n>?text=` link with `templates/whatsapp-message.txt` prefilled; the user presses Send. `prepareLeads` sorts the top two tiers by WhatsApp priority first, and the workbook leads with a **WhatsApp** sheet.
- **France and Belgium** reuse every rule above. Their legal notices are *mentions légales* (FR: *directeur de la publication*, *gérant*) and *colofon* (BE: *zaakvoerder*), so the role labels, honorifics (Madame/Mme/Monsieur, Mevrouw/Dhr.), company forms (SARL, SAS, BVBA, NV…), non-profit forms (ASBL/VZW, which always drop like e.V.), freemail (orange, free, skynet, telenet…) and public-body domains (`mairie-*.fr`, `<city>.fr/.be`, `*.gouv.fr`) are extended for them. Belgian postcodes have 4 digits; `cityFromAddress` reads 4–5.
- **A restart resumes; it never overwrites** (`resume.js`). Before this, re-running after a crash began at query 1 and its first save replaced the stopped run's files. Now `main.js` loads the output folder's `leads.json`, marks those places seen, re-queues the ones whose website lookup may not have finished (`contacts_checked` is set when a lookup completes), and starts at `progress.json`'s `next`. `progress.json` is written after every query and is trusted only if its country and query count match the current run. Without one, the run resumes at the last query that produced a place. A finished run exits with a hint instead of re-running; `--fresh` moves the old files to `previous-<date>/` first.
- **Maps is loaded with `?hl=en&gl=<country>`**: local results with an English UI. The extractors read English labels (`stars`, `reviews`, `Add website`). Supporting one UI language is much easier than supporting two. Don't drop `hl=en` without also teaching `dom-extract.js` German labels, and prove it with a fixture.
- **EU consent redirect.** From an EU IP, Maps first redirects to `consent.google.com`. `passConsent` answers it. `detectBlockPage` must **not** treat consent as a block (the US original did).
- **Phones are international.** `normPhone` in `dom-extract.js` turns a national `0…` number into `+<phoneCode>…` (`030 …` → `+4930…`, `020 …` → `+4420…`; `extractDetail` takes the code as its argument), keeps anything that already has `+`/`00`, and never rewrites a foreign number.
- **Foreign results are dropped** by address suffix (the profile's `foreign` regex). Border-city searches return Austrian, Swiss, French and Dutch shops.
- **Relevance matches at word starts only** (`countHits` in `relevance.js`). A bare substring test finds "tora" in "Restaurierung". Glass words match anywhere because of compounds like "Kunstglas" and "Bleiglas". A category in `NON_RETAIL_CATEGORY` (restaurant, café, cemetery, glazier…) caps the score unless the *name* carries a strong Judaica word.
- **Only sellable businesses are kept** (`isSellable` in `relevance.js`). A non-profit / religious Maps category (synagogue, community, non-profit, institute, school, library, museum…) or name (e.V., Gemeinde, Chabad, Stiftung, Verein…) drops the place at the feed stage and again on the detail page, before its website is read. A retail category (store, shop, gallery…) overrides a non-profit-sounding name, so a Chabad-run Judaica store survives. A Judaica word in the name overrides a wrong non-profit category ("Judaica Direct" filed as *Public Library*). Retail evidence for the tiers comes from the listing only, never the website, because every community site links to a shop page. A public body — website or email on a government domain (`stadt-*.de`, `*.rlp.de`) or on `<city>.de` — is dropped too, and this check runs before the Judaica-name exception ("Germania Judaica" is Cologne's city library). "Jewish / Israeli retail" needs Jewish/Israeli context in the listing, or a Judaica object named on the site; "Israel" in site text alone matched every bookshop and gallery with one Israeli author. Some names are institutions under any category (`INSTITUTION_NAME`: museum, synagogue, school, library, charity, foundation, e.V.): "Ben Uri Gallery and Museum" is filed as an *Art Gallery*. Chabad is deliberately not on that list, because Chabad runs real Judaica stores. `e.V.` always drops the place; the other institution words don't apply when the name is also a company or a bookshop (`COMMERCIAL_NAME`: GmbH, KG, Ltd, Buchhandlung, bookstore…), so "Deutsches Museum Shop GmbH", university bookstores and "Literaturhandlung im Jüdischen Museum" (a private Judaica bookshop) stay. The public-body check reads the website; the email decides only when there is no website, because a shop's pages can carry a city-portal address. `keepNonProfits: true` turns the filter off.
- **Brand-prone Judaica words** (`BRAND_PRONE`: menorah, star of david…) count in a business NAME only when the listing is a shop. England had "Menorah Massage", "Menorah Homes", "Menorah Hotel" and a landmark called The Menorah. Challah (bread) and kiddush (wine) are context words, not Judaica objects; the Judaica object is the *challah cover* or *kiddush cup*. "Jaffa" is not a context word (in England it's the orange and the cake).
- **City comes from the address** (`pickCity` / `cityFromAddress` in `maps.js`), not from the search, which is only where we looked: "Judaica Chelmsford" returned Manchester Judaica in Salford. In Germany, Maps' English UI puts the district after the postcode ("50823 Ehrenfeld", "01279 Dresden-Leuben"), so there the address town wins only when it is itself one of the searched cities (or its part before a hyphen is); otherwise the searched city stays. UK addresses carry the real post town. The address city also keys the duplicate check, so a place returned by searches in several towns is kept once.
- **One email per address**: `uniqueByEmail` keeps the best row per address on the Outreach sheet and in `mail-merge.csv`, so a chain (Shefa Mehadrin in Manchester and London) gets the email once.
- **Email ranking** (`rankEmails`): +40 for the site's own domain, +20 when the domain spells the business name, +25 when the local part does (`israelladen@mail.bgkorntal.de`), +15 for freemail, +10 for info/kontakt/shop prefixes, −30 for datenschutz/noreply/jobs, −25 for agency-looking domains. Web designers put their own address in the footer, and it must never win. The +40 applies only when the site is the shop's own (a homepage, or a domain spelling its name); a deep page on an umbrella organisation's site (`chabad-duesseldorf.de/…/aid/3860766` for Kosher King) gets none, so the umbrella's info@ doesn't win. Marketplace and platform pages (Kleinanzeigen, eBay, Etsy, AbeBooks, Facebook…) are never crawled, and their addresses are discarded. `repairTld` and `dropGlued` undo words glued onto addresses (`…@israelladen.deein`, `ninfo@…`).
- **Greeting gender only from evidence** (`greetingFor`): Frau/Herr, or a feminine title (Inhaberin, Geschäftsführerin, Direktorin…). `Mrs`/`Miss`/`Ms` give "Ms." and `Mr` gives "Mr." (an old `Mrs?` pattern once read Mr as female). Masculine titles are generic in German ("Inhaber: Irene Jaworski" produced "Dear Mr. Plattform"), so they never make it "Mr.". Otherwise use the full name. Never guess gender from a first name. With no name, `shortBusinessName` cuts the Maps SEO title at `|`, ` - ` or ` I ` and drops GmbH/GbR.
- **Impressum name extraction** stops at the first word that is a company form, an organisation compound (`…gemeinde`, `…handlung`, `…bibliothek`), a street (`…straße`, `…str`; `…ring`/`…damm` from the third word on), a digit, a word ending in a hyphen (`Online-`) or the next field label (`Sitz`, `Kontaktformular`, `Plattform`…). A company alone (`Vertreten durch: X GmbH`) yields no name, which is correct.

## Recipes

- **Add cities:** edit `GERMAN_CITIES` / `CITY_DISTRICTS` in `src/config.js`.
- **Add search terms:** `DEFAULT_CATEGORIES`. Put strong ones in `HIGH_YIELD` so they run across every city first.
- **Tune relevance:** edit the word lists in `src/relevance.js` and add a case to `test/pipeline.test.js`.
- **A Maps column goes blank:** save the page HTML into `test/fixtures/`, write a failing test in `test/dom-extract.test.js`, then fix the selector.
- **A shop's email is missed:** `npm run contacts -- --probe <url> "<name>"`. If the email is on a page that isn't linked, add the path to `guessContactUrls`. If it is obfuscated in a new way, extend `deobfuscate` and add a test.
