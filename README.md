# Judaica Retailer Scraper (Germany, England, France & Belgium) — Jaffa Glass

Finds every Google Business Profile in **Germany**, **England**, **France** or **Belgium** that sells **Judaica**, plus the Jewish and Israeli gift, book and museum shops around them. It reads each shop's website (the **Impressum** in Germany, the **Contact** page in England) to get an **email address** and the **owner's name**, then writes a spreadsheet and a mail-merge file with the Jaffa Glass partnership email already filled in for each shop.

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

The full run covers **101 cities in all 16 Bundesländer**, and searches the Jewish districts of Berlin, Munich, Frankfurt and Hamburg separately. It uses 10 German search terms, from `Judaica` and `jüdische Geschenke` to `Jüdisches Museum Shop` and `Glaskunst Geschenke`. That comes to about 1,200 Maps searches, which takes several hours. Stop at any time with **Ctrl-C**: results are saved to disk every 10 shops and again on exit. Running the same command again carries on where it stopped (see *If a run stops* below).

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

## France and Belgium

Each country has its own config file and output folder, so no run overwrites another:

```bash
npm run smoke:france     # Paris only, 2 search terms, 10 shops → output-fr-smoke/
npm run france           # all of France → output-fr/          (input.france.json)
npm run smoke:belgium    # Antwerp only, 2 search terms, 10 shops → output-be-smoke/
npm run belgium          # all of Belgium → output-be/         (input.belgium.json)
```

Put your name and title in `"sender"` in each file.

| | France | Belgium |
|---|---|---|
| Places | 59 cities in 12 regions, plus Paris (Le Marais, 9e, 16e, 17e, 19e…) and Marseille neighbourhoods searched separately. Includes Sarcelles, Créteil, Saint-Mandé, Neuilly, Strasbourg, Lyon, Nice | Brussels (Uccle, Forest, Saint-Gilles, Ixelles…), Antwerp (Diamantwijk, Berchem, Wilrijk…) and 14 more cities |
| Search terms | 10 French: `Judaica`, `Cadeaux juifs`, `Librairie juive`, `Épicerie casher`, `Art juif`… | 10 Dutch and French: `Judaica winkel`, `Joodse geschenken`, `Koosjer winkel`, `Cadeaux juifs`… |
| Searches | about 710 | about 280 |
| Contact page | *Mentions légales*, which name the *directeur de la publication* or *gérant* | Contact page / *mentions légales* / *colofon* (*zaakvoerder*) |
| Phones | `+33`; mobiles start `+336`/`+337` | `+32`; mobiles start `+3245`–`+3249` |

The same filters apply: synagogues, the Consistoire, Chabad houses, associations, ASBL/VZW, schools, museums and city halls (`mairie-….fr`, `antwerpen.be`) are skipped.

## WhatsApp: which shops have it, and who to contact first

Every row gets three WhatsApp columns. The **WhatsApp** sheet lists every target you can message, best evidence first. In every sheet, shops with WhatsApp come before the rest.

| WhatsApp column says | What it means | Order |
|---|---|---|
| **Yes — WhatsApp link on website** | The shop's own site has a WhatsApp button or link (wa.me…), or names a WhatsApp number. That number is used, even if it differs from the Maps phone. | 1st |
| **Yes — WhatsApp link on Google listing** | The Maps listing links to WhatsApp. | 1st |
| **Yes — verified by hand** | You marked it yourself (see below). | 1st |
| Likely — website mentions WhatsApp | The site says "WhatsApp" but gives no link. | 2nd |
| Likely — mobile number | Mobiles are almost always on WhatsApp. | 2nd |
| Check — landline | WhatsApp Business also runs on landlines. In the England list, 21 of the 34 shops with WhatsApp were landlines, so these are worth one click. | 3rd |
| No phone | — | last |

The **WhatsApp Chat** column has an **Open chat** link. It opens WhatsApp (app or web) with your intro message already typed, and you press Send yourself. If the number isn't on WhatsApp, WhatsApp says so at once, so this link is also the quickest way to check a "Likely" or "Check" row. Nothing is ever sent automatically. The intro text is in `templates/whatsapp-message.txt`, and you can edit it there.

There's no free, permitted way to ask WhatsApp whether a number is registered without opening the chat, which is why the evidence comes first and the rest is one click to check. To record your own checks, add a `whatsapp_verified` value (`yes` / `no`) to the rows in `leads.json` and run `npm run contacts -- <folder>/leads.json --input <country file>`. A hand check always overrides what the scraper found.

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
| `country` | `"DE"` | `"DE"` Germany, `"UK"` England, `"FR"` France, `"BE"` Belgium. It sets the city list, search terms, phone code, contact pages and output folder. |
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
npm test                                                               # 97 offline tests
```

## If a run stops (crash, Ctrl-C, computer switched off)

Just run the same command again (`npm start` or `npm run england`). The new run carries on where the old one stopped:
- **Places kept:** it loads the places already found and never looks them up twice.
- **Where it restarts:** it continues from the search it was on, which is recorded in `progress.json` in the output folder.
- **Websites re-checked:** it re-reads the websites the stopped run hadn't finished reading.

Nothing already saved is overwritten.

If a run already finished, running it again tells you so and stops. To search again from the beginning, add `--fresh`. The old results are moved into a `previous-<date>` folder, not deleted:

```bash
npm run england -- --fresh
```

## If Google blocks you

1. Keep `"headless": false`.
2. Raise `delayBetweenQueries` to about `9000`.
3. Run one region at a time, e.g. `"states": ["NW"]`.
4. Use a proxy (`browser.proxyServer`) or a Bright Data browser (`BRIGHTDATA_WSS` in `.env`, which costs money).

The scraper detects Google's "unusual traffic" page and says so, rather than reporting an empty search. It also answers the EU cookie-consent page (consent.google.com) automatically.

## A note on sending (France and Belgium)

- **France:** the CNIL lets you email professionals without prior consent, provided the message relates to their trade (Judaica for a Judaica shop qualifies) and every message has a simple way to opt out.
- **Belgium:** this is stricter. Without prior consent, you may email a company only at a **generic** address (`info@`, `contact@`, `winkel@`), not a named person's address.
- **WhatsApp messages** follow the same rules as email in both countries. WhatsApp also bans accounts that get reported for unwanted messages. Send each message yourself, keep it personal, and stop at the first "no".

This isn't legal advice.

## A note on sending (England)

In the UK, **PECR** and **UK GDPR** apply. You may email a *company* (Ltd, LLP, plc) without prior consent if the message is relevant to its business and offers an easy opt-out. **Sole traders and partnerships** count as individuals, and they need consent first. Many small Judaica shops are sole traders, so treat "Ltd" in the Impressum/footer as the signal. As in Germany: send individually, honour opt-outs at once, and this isn't legal advice.

## A note on sending (Germany)

Cold email to businesses in Germany is regulated by **§ 7 UWG** and the GDPR. B2B email is generally allowed only where you can reasonably assume the recipient is interested. A shop that sells Judaica, receiving a relevant supplier offer, is a much stronger case than a random list, which is one reason the relevance filter exists. Even so:

- Send individually or in small batches, not as a bulk blast.
- Give a clear way to opt out and honour it at once.
- Keep the scraped data only as long as you need it for this outreach.

This is not legal advice. If you plan a large campaign, check with someone who knows German marketing law.
