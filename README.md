# German Judaica Retailer Scraper — Jaffa Glass

Finds every Google Business Profile in Germany that sells **Judaica**, plus the Jewish and Israeli gift, book and museum shops around them. It reads each shop's website and **Impressum** to get an **email address** and the **owner's name**, then writes a spreadsheet and a mail-merge file with the Jaffa Glass partnership email already filled in for each shop.

It runs on your own computer with Node and your own Chrome. No accounts, no API keys, and no cost per lead.

> Working with Claude Code? See **CLAUDE.md** for the architecture and task recipes.

## 1. Install

You need Node.js 18 or newer (`node -v`) and Google Chrome (Chromium, Brave or Edge also work).

```bash
npm install
cp input.example.json input.json          # macOS / Linux
copy input.example.json input.json        # Windows
```

Open `input.json` and put your own details in `sender`. They fill `[Your Name]` and `[Title]` in the email:

```json
"sender": { "name": "Dana Levi", "title": "Export Manager" }
```

## 2. Smoke test, then the full run

```bash
npm run smoke      # Berlin only, 2 search terms, stops at 10 shops, visible browser
npm start          # all of Germany
```

The smoke test writes to `output-smoke/`. Open `judaica-leads.xlsx` there and check that the shops are real Judaica shops and the emails look right. Then start the full run.

The full run covers **101 cities in all 16 Bundesländer**, and searches the Jewish districts of Berlin, Munich, Frankfurt and Hamburg separately. It uses 10 German search terms, from `Judaica` and `jüdische Geschenke` to `Jüdisches Museum Shop` and `Glaskunst Geschenke`. That comes to about 1,200 Maps searches, which takes several hours. Stop at any time with **Ctrl-C**: results are saved to disk every 10 shops and again on exit.

## 3. What you get (in `output/`)

| File | What it's for |
|---|---|
| **`judaica-leads.xlsx`** | Three sheets: **Outreach** (target shops that have an email), **No email found** (targets to phone or message on Facebook), and **All results** (everything scraped). In the Email column, click an address to open a pre-written email. |
| **`mail-merge.csv`** | One row per target: `email, greeting, contact_name, business_name, city, website, email_subject, email_body`. You can load it into GMass, YAMM (Gmail), Outlook/Word mail merge or Mailchimp. |
| `leads.csv` / `leads.json` | Every row, with all fields. |

### How each email is personalised

German law (§ 5 DDG) requires every commercial website to have an **Impressum** that names the owner or managing director. The scraper reads it:

| Impressum says | Greeting in the email |
|---|---|
| `Geschäftsführerin: Frau Dr. Miriam Rosenthal` | Dear Ms. Dr. Rosenthal, |
| `Inhaber: David Levi` | Dear Mr. Levi, |
| `Verantwortlich: Sarah Cohen` (no gender given) | Dear Sarah Cohen, |
| no name found | Dear Judaica Haus Berlin Team, |

It only uses Mr./Ms. when the site itself gives the gender (Frau/Herr, Inhaberin/Inhaber). Otherwise it uses the full name.

Emails are also found when they are hidden behind Cloudflare email protection or written as `info [at] shop [dot] de`. They are ranked so that the shop's own address (`info@shop.de`) beats a freemail address, and both beat the web designer's address in the footer or a `datenschutz@` address.

To change the email text, edit **`templates/partnership-email.txt`**. The first line is the subject. You can use `{{greeting}}`, `{{sender_name}}`, `{{sender_title}}`, `{{business_name}}`, `{{city}}` or any other column name.

### Relevance: which shops are targets

Maps search is fuzzy. A search for `koscher` also returns kosher restaurants, and `Judaica` also returns synagogues. So each place is scored on the words in its name, category, Maps description and its own website, then put in a tier:

| Tier | Meaning | On the Outreach sheet? |
|---|---|---|
| **Judaica seller** | Name or website mentions Judaica, Menora, Mesusa, Kiddusch-Becher, Sederteller… | ✅ |
| **Jewish / Israeli retail** | A shop (book, gift, grocery, museum shop) with Jewish or Israeli context | ✅ |
| Glass & gift shop | Sells glass or gifts, with no Jewish context found | opt-in |
| Community / synagogue | Gemeinde, synagogue, Chabad. Some run a shop. | opt-in |
| Unrelated / Not a retailer | Restaurants, cafés, cemeteries, glaziers… | ❌ |

The **Why it matched** column shows which words caused the match. To include more tiers, set:

```json
"includeTiers": ["Judaica seller", "Jewish / Israeli retail", "Glass & gift shop", "Community / synagogue"]
```

## 4. Configuration (`input.json`)

All fields are optional.

| Field | Default | Meaning |
|---|---|---|
| `sender` | – | `{ "name", "title" }` for the email signature. |
| `states` | all | Bundesland codes to limit the run, e.g. `["BE","BY","HE"]`. Codes: BE HH HB BY BW HE NW NI RP SL SH MV BB SN ST TH. |
| `cities` | built-in list | An explicit list of cities, which replaces the built-in one. |
| `districts` | `true` | Also search the Jewish districts of Berlin, Munich, Frankfurt and Hamburg. |
| `searchCategories` | 10 German terms | Replaces the search terms (see `src/config.js`). |
| `includeTiers` | Judaica + Jewish/Israeli retail | Which relevance tiers go on the Outreach sheet and into the mail merge. |
| `maxLeads` | `5000` | Stop after this many places. |
| `maxResultsPerQuery` | `60` | How many places to open per search. |
| `delayBetweenQueries` / `delayBetweenListings` | `4000` / `1800` | Pauses in ms. Raise them if Google starts blocking you. |
| `browser.headless` | `false` in the example | A visible browser is harder for Google to detect. |
| `contacts.enabled` | `true` | Turns the website and Impressum lookup on or off. |
| `contacts.maxPagesPerSite` | `4` | Homepage + Impressum/Kontakt/About pages to read per shop. |
| `emailTemplate` | `templates/partnership-email.txt` | Path to a different template. |

## 5. Useful commands

```bash
npm run contacts -- --probe https://some-judaica-shop.de "Shop Name"   # test one website
npm run contacts -- output/leads.json                                  # re-read every website, rewrite output/
npm test                                                               # 50 offline tests
```

## If Google blocks you

1. Keep `"headless": false`.
2. Raise `delayBetweenQueries` to about `9000`.
3. Run one region at a time, e.g. `"states": ["NW"]`.
4. Use a proxy (`browser.proxyServer`) or a Bright Data browser (`BRIGHTDATA_WSS` in `.env`, which costs money).

The scraper detects Google's "unusual traffic" page and says so, rather than reporting an empty search. It also answers the EU cookie-consent page (consent.google.com) automatically.

## A note on sending (Germany)

Cold email to businesses in Germany is regulated by **§ 7 UWG** and the GDPR. B2B email is generally allowed only where you can reasonably assume the recipient is interested. A shop that sells Judaica, receiving a relevant supplier offer, is a much stronger case than a random list, which is one reason the relevance filter exists. Even so:

- Send individually or in small batches, not as a bulk blast.
- Give a clear way to opt out and honour it at once.
- Don't email the Community / synagogue tier unless you have a specific reason.
- Keep the scraped data only as long as you need it for this outreach.

This is not legal advice. If you plan a large campaign, check with someone who knows German marketing law.
