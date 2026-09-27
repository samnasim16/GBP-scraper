# Judaica Retailer Scraper (Germany & England) — Jaffa Glass

Finds every Google Business Profile in **Germany** or **England** that sells **Judaica**, plus the Jewish and Israeli gift, book and museum shops around them. It reads each shop's website (the **Impressum** in Germany, the **Contact** page in England) to get an **email address** and the **owner's name**, then writes a spreadsheet and a mail-merge file with the Jaffa Glass partnership email already filled in for each shop.

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

## England

England has its own config, so Germany and England never overwrite each other:

```bash
npm run smoke:england    # London only, 2 search terms, 10 shops → output-uk-smoke/
npm run england          # all of England → output-uk/
```

Put your name and title in `"sender"` in **`input.england.json`**. It is a separate file from `input.json`.

The England run covers **68 towns and cities in 9 regions** and searches the Jewish neighbourhoods of London and Manchester separately:
- **London:** Golders Green, Hendon, Stamford Hill, Edgware, Stanmore, Finchley and more.
- **Manchester:** Prestwich, Whitefield, Broughton Park and more.

It uses 10 English search terms, from `Judaica` and `Jewish gift shop` to `kosher deli` and `art glass gallery`, for about 930 Maps searches.

To run only some regions, set `"states"` in `input.england.json` to any of `LDN EE SE NW NE YH WM EM SW`. For example, `["LDN", "EE"]` covers London plus Hertfordshire and Essex (Borehamwood, Radlett, Bushey, Southend, Westcliff).

What changes for England:
- **Phone numbers** become `+44`.
- **Irish and Continental results** are dropped.
- **Contact details** come from the **Contact / About** pages, because UK sites have no Impressum.
- **Organisations** are filtered the same way as in Germany: synagogues, Chabad, charities, community centres (JW3 and similar), museums and councils (`.gov.uk`).
- **Named contacts** will be rarer than in Germany. UK sites aren't required to name the owner, so more emails will open with "Dear <Shop> Team".

The same `npm run contacts` command works on an England export:

```bash
npm run contacts -- output-uk/leads.json --input input.england.json
```

## 3. What you get (in `output/`, or `output-uk/` for England)

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
| `Herr David Levi` | Dear Mr. Levi, |
| `Inhaber: Irene Jaworski` (masculine label, used generically) | Dear Irene Jaworski, |
| `Verantwortlich: Sarah Cohen` (no gender given) | Dear Sarah Cohen, |
| no name found | Dear Judaica Haus Berlin Team, |

It uses Mr. or Ms. only when the site itself gives the gender: Frau/Herr, or a feminine title such as Inhaberin, Geschäftsführerin or Direktorin. Masculine titles like "Inhaber" don't count, because German uses them for women too. Otherwise it uses the full name.

With no name, it greets the shop by its short name. The long Google Maps title "Israel Spezialitäten | Die besten Medjoul Datteln | Dieterich" becomes "Dear Israel Spezialitäten Team", and GmbH/GbR are dropped.

Emails are also found when they are hidden behind Cloudflare email protection or written as `info [at] shop [dot] de`. They are ranked so that the shop's own address (`info@shop.de`) beats a freemail address, and both beat the web designer's address in the footer or a `datenschutz@` address.

To change the email text, edit **`templates/partnership-email.txt`**. The first line is the subject. You can use `{{greeting}}`, `{{sender_name}}`, `{{sender_title}}`, `{{business_name}}`, `{{city}}` or any other column name.

### Relevance: which shops are targets

**Only businesses you can sell to are kept.** Synagogues, Chabad houses, Jewish communities (Gemeinde), registered non-profits (e.V.), foundations, associations, institutes, schools, universities, libraries, museums, memorials and embassies are skipped, based on their Maps category and their name. City and state institutions are skipped as well, recognised by a government website or email (e.g. `stadt-koeln.de`, `speyer.de`). They aren't opened, their websites aren't read, and they don't appear in the output. A shop run by a community still counts if Maps lists it as a store (for example Chabad's "Judaica-Laden", a *Judaica Store*). To keep the organisations anyway, set `"keepNonProfits": true`.

Maps search is fuzzy. A search for `koscher` also returns kosher restaurants, and `Judaica` also returns synagogues. So each place is scored on the words in its name, category, Maps description and its own website, then put in a tier:

| Tier | Meaning | On the Outreach sheet? |
|---|---|---|
| **Judaica seller** | Name or website mentions Judaica, Menora, Mesusa, Kiddusch-Becher, Sederteller… | ✅ |
| **Jewish / Israeli retail** | A shop (book, gift, grocery, museum shop) with Jewish or Israeli context | ✅ |
| Glass & gift shop | Sells glass or gifts, with no Jewish context found | opt-in |
| Unrelated / Not a retailer | Restaurants, cafés, cemeteries, glaziers… | ❌ |

The **Why it matched** column shows which words caused the match. To include more tiers, set:

```json
"includeTiers": ["Judaica seller", "Jewish / Israeli retail", "Glass & gift shop"]
```

## 4. Configuration (`input.json`)

All fields are optional.

| Field | Default | Meaning |
|---|---|---|
| `country` | `"DE"` | `"DE"` for Germany or `"UK"` for England. It sets the city list, search terms, phone code and output folder. |
| `sender` | – | `{ "name", "title" }` for the email signature. |
| `states` | all | Bundesland codes to limit the run, e.g. `["BE","BY","HE"]`. Codes: BE HH HB BY BW HE NW NI RP SL SH MV BB SN ST TH. |
| `cities` | built-in list | An explicit list of cities, which replaces the built-in one. |
| `districts` | `true` | Also search the Jewish districts of Berlin, Munich, Frankfurt and Hamburg. |
| `searchCategories` | 10 German terms | Replaces the search terms (see `src/config.js`). |
| `keepNonProfits` | `false` | Keep synagogues, communities, e.V.s, schools, museums etc. (they are dropped by default). |
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
npm test                                                               # 70 offline tests
```

## If Google blocks you

1. Keep `"headless": false`.
2. Raise `delayBetweenQueries` to about `9000`.
3. Run one region at a time, e.g. `"states": ["NW"]`.
4. Use a proxy (`browser.proxyServer`) or a Bright Data browser (`BRIGHTDATA_WSS` in `.env`, which costs money).

The scraper detects Google's "unusual traffic" page and says so, rather than reporting an empty search. It also answers the EU cookie-consent page (consent.google.com) automatically.

## A note on sending (England)

In the UK, **PECR** and **UK GDPR** apply. You may email a *company* (Ltd, LLP, plc) without prior consent if the message is relevant to its business and offers an easy opt-out. **Sole traders and partnerships** count as individuals, and they need consent first. Many small Judaica shops are sole traders, so treat "Ltd" in the Impressum/footer as the signal. As in Germany: send individually, honour opt-outs at once, and this isn't legal advice.

## A note on sending (Germany)

Cold email to businesses in Germany is regulated by **§ 7 UWG** and the GDPR. B2B email is generally allowed only where you can reasonably assume the recipient is interested. A shop that sells Judaica, receiving a relevant supplier offer, is a much stronger case than a random list, which is one reason the relevance filter exists. Even so:

- Send individually or in small batches, not as a bulk blast.
- Give a clear way to opt out and honour it at once.
- Keep the scraped data only as long as you need it for this outreach.

This is not legal advice. If you plan a large campaign, check with someone who knows German marketing law.
