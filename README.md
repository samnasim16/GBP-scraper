# Judaica Retailer Scraper (Germany, England, France, Belgium, USA & Israel) — Jaffa Glass

Finds every Google Business Profile in **Germany**, **England**, **France**, **Belgium**, the **United States** or **Israel** that sells **Judaica**, plus the Jewish and Israeli gift, book and museum shops around them. It reads each shop's website (the **Impressum** in Germany, the **Contact** page in England) to get an **email address** and the **owner's name**, then writes a spreadsheet and a mail-merge file with the Jaffa Glass partnership email already filled in for each shop.

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

## United States (New York, New Jersey, Florida)

```bash
npm run smoke:us     # Borough Park only, 2 search terms, 10 shops → output-us-smoke/
npm run us           # NY, NJ and FL → output-us/   (input.us.json)
```

Put your name and title in `"sender"` in `input.us.json`.

- **Places:** 104 searches per term: New York (Manhattan, Brooklyn — Borough Park, Williamsburg, Crown Heights, Flatbush, Midwood… — Queens — Kew Gardens Hills, Far Rockaway… — the Five Towns, Great Neck, Westchester, Monsey, Monroe/Kiryas Joel, upstate), New Jersey (Lakewood, Jackson, Teaneck, Englewood, Passaic, Highland Park, Deal…) and Florida (Miami Beach, Surfside, Aventura, Hollywood, Boca Raton, Orlando, Tampa…). Every city carries its state, so "Lawrence, NY" is not searched in Kansas.
- **Search terms:** `Judaica`, `Judaica store`, `Jewish gift shop`, `Seforim store`, `Jewish bookstore`, `Israeli gifts`, `Jewish museum shop`, `kosher supermarket`, `Menorah`, `art glass gallery`: about 1,040 searches. The first four run across every city first.
- **City and State columns** come from the address ("…, Brooklyn, NY 11219"). A Teaneck search that finds a Monsey shop says Monsey, NY.
- **Phones** are `+1`. US mobile and landline numbers share area codes, so the number alone can't say which it is. Unless the shop's website or listing shows WhatsApp, the WhatsApp column says **Check — US number (mobile or landline unknown)**.
- **Not buyers:** synagogues (including *Temple …* and *Congregation …* gift shops, which the sisterhood runs), Young Israel, JCCs, yeshivas, Hadassah thrift shops, and `.gov` websites.
- **The email and WhatsApp message** use the US versions in `templates/partnership-email-us.txt` and `templates/whatsapp-message-us.txt`. They say the collection is now coming to the US, and the email ends with an opt-out line (see *A note on sending (US)*).

To add more states later, add them to `US_CITIES` in `src/config.js` and to `"states"` in `input.us.json`.

## Israel

```bash
npm run smoke:israel     # Geula (Jerusalem) only, 2 search terms, 10 shops → output-il-smoke/
npm run israel           # all of Israel → output-il/   (input.israel.json)
```

Put your name and title in `"sender"` in `input.israel.json`. You can write it in Hebrew.

- **Places:** 76 searches per term across every district.
  - Jerusalem, searched neighbourhood by neighbourhood: Mea Shearim, Geula, the Old City and Jewish Quarter, Ben Yehuda, Mamilla, Har Nof…
  - Bnei Brak (Rabbi Akiva Street), Safed (the Artists' Colony), Tel Aviv-Jaffa and the coastal and southern cities.
  - The Haredi towns: Beit Shemesh, Elad, Modi'in Illit, Beitar Illit.
- **Search terms:** Hebrew first, since most shops list themselves in Hebrew: `יודאיקה`, `תשמישי קדושה`, `כלי קודש`, `חנות יודאיקה`, `ספרי קודש`, `חנות מתנות`, `מזכרות`. English terms too: `Judaica`, `Souvenir shop`, `Art glass gallery`. About 760 searches in total.
- **Who is a target:**
  - Every shop in Israel is Jewish and kosher, so "Jewish context" doesn't count. A kosher supermarket is not a target.
  - The targets are **Judaica sellers** (Hebrew or English Judaica words in the listing or on the site) and **gift, souvenir, art and glass shops**, which sell Judaica to visitors.
  - Hebrew prefixes are understood ("והמזוזות" counts as מזוזות), but "מטלית" (cleaning cloth) is not "טלית".
  - "מנורה" doesn't count, because in Hebrew it is any lamp.
  - Toy shops, florists, photo shops, malls, furniture stores and glaziers are never gift-shop targets.
  - Directory pages (Dapei Zahav, B144, Easy, Zap) are not read as a shop's website.
- **Not buyers:** synagogues (בית כנסת), yeshivas (ישיבה), gemachs (גמ"ח), non-profits (עמותה), museums, schools, and `gov.il` / `muni.il` sites. A name with בע"מ (Ltd) is treated as a company.
- **Contact pages:** "צור קשר" / "אודות". Israeli inboxes (walla, netvision, bezeqint, 012/013) count as the shop's own.
- **Phones** are `+972`. Mobiles (`05…`) show as **Likely** on WhatsApp.
- **The email and WhatsApp message are in Hebrew** (`templates/partnership-email-il.txt`, `templates/whatsapp-message-il.txt`). They follow your English email, but read as selling in Israel, not exporting. **Read them before sending**, especially the Hebrew street names of your facilities.

## Sushi restaurants in Israel (glass plates and cups)

A separate campaign: the same scraper, looking for every **sushi place in Israel** to offer Jaffa Glass's hand-made glass plates and cups. It has its own config, folder and templates, so it never touches the Judaica results.

```bash
npm run smoke:sushi:israel   # Dizengoff (Tel Aviv) only, 2 search terms, 10 places → output-il-sushi-smoke/
npm run sushi:israel         # all of Israel → output-il-sushi/   (input.israel-sushi.json)
```

Put your name and title in `"sender"` in `input.israel-sushi.json`. The results are in **`sushi-leads.xlsx`** and `mail-merge.csv`.

- **Places:** 85 towns, plus the restaurant streets of the big cities searched one by one, since Maps shows at most about 120 places per search:
  - Tel Aviv: the Old North, New North, Dizengoff, Rothschild, Florentin, Neve Tzedek, Sarona, Ramat Aviv, Ramat HaHayal, the Port and more.
  - Jerusalem: the City Center, Mahane Yehuda, the German Colony, Talpiot, Mamilla and more.
  - Haifa: the Carmel Center, the German Colony and Downtown.
  - Herzliya Pituach, Ramat Gan's Diamond Exchange, Jaffa.
- **Search terms:** `סושי`, `Sushi`, `מסעדת סושי` (across every place first), then `משלוחי סושי`, `מסעדה יפנית`, `Japanese restaurant`, `מסעדה אסייתית`, `Asian restaurant`. That's 984 searches; expect the full run to take most of a day. A restart carries on where it stopped.
- **Who is a target:**

| Tier | Meaning | Gets the email? |
|---|---|---|
| **Sushi place** | Sushi in the name, category or Maps description (restaurant, bar, takeaway, delivery, caterer), or on the menu of its website | ✅ |
| **Japanese / Asian restaurant** | Japanese, Asian, ramen, poke, wok, Chinese, Thai… with no sushi seen yet (in Israel most of them serve it) | ✅ |
| Other restaurant | A restaurant, café or bar with no sushi on its listing and at most one mention on its site | ❌ |
| Not a restaurant | Supermarket sushi counters, fish shops, sushi-supply wholesalers, cooking schools, malls (dropped before they are opened) | ❌ |

  To email only the sushi places, set `"includeTiers": ["Sushi place"]` in `input.israel-sushi.json`.
- **Ordering and booking pages** (Wolt, 10bis, Mishloha, Ontopo, Tabit, rest.co.il, Uber Eats…) and restaurant directories (israelbusinessguide.com, rol.co.il, Bali B Click) are not read as a restaurant's website, so their inboxes never show up as the restaurant's email. Mishlohim pages are read, but Mishlohim's own address is ignored.
- **Not targets:** Japanese spas, Chinese-medicine clinics and parks, even with "Japanese" or "Chinese" in the name. Restaurants in Hebron, Bethlehem and abroad (Arad in Romania, Sushi Modo in Canada) are dropped.
- **1-700 / 1-800 numbers** show as **No — 1-700 / 1-800 service number** in the WhatsApp column, with no chat link: nobody can message them.
- **The email and WhatsApp message** are the JaffaGlass outreach drafts (Email 1: "Quick question about {{shop_name}}'s sushi plates", Zack, WhatsApp +972 53-854-8320, "no thanks" opt-out), the same as the Europe and Germany runs. The earlier Hebrew drafts are still in `templates/sushi-email-il.txt` and `templates/sushi-whatsapp-il.txt`. Israel's anti-spam law expects "פרסומת" at the start of an advertising email's subject; the English draft doesn't have it (see *A note on sending (Israel)*).
- **Not in Israel:** addresses in Ramallah/Al-Bireh, Hebron, Bethlehem or Jordan, and places with a Palestinian Authority number (+970) even when the address reads "Jerusalem".

## Sushi restaurants across Europe

The same sushi scraper, for every country in Europe: all EU members, the UK, Norway, Switzerland, Iceland, the microstates, the Balkans, Moldova, Ukraine, Belarus, European Russia and Istanbul (46 countries).

```bash
npm run smoke:sushi:europe   # Portugal only, 1 search term, 10 places → output-eu-sushi-smoke/
npm run sushi:europe         # all of Europe → output-eu-sushi/   (input.europe-sushi.json)
```

- **The list:** `output-eu-sushi/sushi-europe-list.csv` has one row per sushi place: name, city, country, address, rating, reviews, phone, website, Maps link. `sushi-europe.xlsx` is the usual workbook (WhatsApp · Outreach · No email found · All results).
- **Sushi places only:** Japanese and Asian restaurants with no sushi on their listing are on All results, not on the list.
- **Places:** 438 searches per term: every capital and each country's larger cities, and the biggest cities (London, Paris, Berlin, Madrid, Barcelona, Rome, Milan, Moscow, Istanbul…) district by district. Two terms, `Sushi restaurant` across every place first, then `Sushi`: 876 searches. Expect a day or more; a restart carries on where it stopped.
- **Some countries only:** set `"states"` in `input.europe-sushi.json`, e.g. `["FR", "DE", "UK"]`. Use `"states"`, not `"cities"`: each country is searched as itself (its own Google region and phone code), and a bare city list has no country.
- **Country column:** the country the place is in. A search in Strasbourg that finds a place in Kehl says Germany. Results outside Europe (Paris, Texas; Valencia, Venezuela) are dropped.
- **Website lookup is off** (`"contacts": { "enabled": false }`), because the list doesn't need emails and it makes the run much faster. Turn it on to get emails.
- **The email** is Email 1 of the JaffaGlass outreach sequence (`templates/sushi-email-en.txt`): "Quick question about {{shop_name}}'s sushi plates", signed by Zack with WhatsApp +972 53-854-8320. It opens "Hi there" unless you fill in a `first_name` by hand: names are never guessed, because many owners' Impressum names put the family name first ("Thi Bich Thuy Nguyen"). Emails 2–6 (follow-ups, catalog, close) are sent by hand or by your mail tool as replies in the same thread.

### The workbook (every run)

Every run writes one workbook in the same layout, updated with every save: **WhatsApp** (every target with a number, best evidence first, one row per number: a chain's branches that share one WhatsApp get one message), **Outreach** (one row per email address), **No email found** and **All results**. The Relevance and WhatsApp columns are colour-coded, and "Open chat" opens WhatsApp with the message typed in.

WhatsApp numbers that sites write wrongly are repaired: the trunk 0 kept after the code ("+972 058…", "+49 0211…"), and links without a country code ("wa.me/527320122" is 052-732-0122; "wa.me/15730642210" on a German site is 01573 …, not an American number).

### Sushi in Germany (your own search list)

```bash
npm run sushi:germany        # input.germany-sushi.json → output-de-sushi/sushi-germany-list.csv + sushi-germany.xlsx
```

Websites are read after all the searches are done (`"contacts": { "afterSearch": true }`): reading them alongside the searches made Maps load only 14–34 places per city instead of up to about 120. `input.germany-sushi.json` runs exactly these searches: Sushi Berlin, Nürnberg, Düsseldorf, München, Hamburg, Köln, Frankfurt, Stuttgart, Leipzig, Dortmund. Change `"cities"` to change them; `"states": ["DE"]` keeps them German. Website lookup is on, so German Impressum pages give emails. Note that German law (UWG §7) restricts unsolicited advertising email even to businesses; this isn't legal advice.

## Art buyers in the United States, Israel and worldwide (Varnish AI)

A separate campaign for **Varnish AI**, the web app that helps people sell artwork: the same scraper builds a directory of **galleries, auction houses, art dealers and art advisors** from Google Business Profiles in the US (and Israel and the world's other art markets, below), which Varnish recommends to sellers. It has its own config, folder and templates, so it never touches the Judaica or sushi results.

```bash
npm run smoke:art:us     # New York only, 2 search terms, 10 places → output-us-art-smoke/
npm run art:us           # every US art market → output-us-art/   (input.us-art.json)
npm run contacts -- output-us-art/leads.json --input input.us-art.json   # re-read the websites
```

Varnish imports **`output-us-art/leads.json`**. The workbook is `art-leads.xlsx` (the usual four sheets, with the art columns after Category).

- **Places:** New York and Brooklyn, Los Angeles (with Culver City, West Hollywood and Beverly Hills), San Francisco, Chicago, Miami, Miami Beach, Palm Beach and West Palm Beach, Boston, Washington, Philadelphia, Seattle, Santa Fe and Taos, Scottsdale and Sedona, Dallas, Houston, Denver and Aspen, Atlanta, Charleston, Nashville, Minneapolis, New Orleans, and the Hamptons, Hudson, Carmel and Naples. The gallery districts are searched one by one: Chelsea, the Upper East Side, Tribeca, the Lower East Side, SoHo, Williamsburg, Wynwood, the Design District, River North, Canyon Road, Houston's Museum District… To run only some states, set `"states"` in `input.us-art.json` (`NY CA FL IL TX MA DC PA WA NM AZ CO GA SC TN MN LA`).
- **Search terms:** `Art gallery`, `Auction house`, `Art dealer` and `Art advisor` across every place first, then `Contemporary art gallery`, `Fine art gallery`, `Art auction` and `Art consultant`.
- **Websites are read once every search is done** (`"afterSearch": true`), as in the sushi runs, so Maps keeps loading full result lists. For each place it reads the homepage, the contact / visit / info pages, and one submissions page and one consign page if the site links them.
- **Who is in the directory:**

| Tier | Meaning | In the directory? |
|---|---|---|
| **Gallery** | An art gallery: Maps files it as one, its name says gallery, or its site shows exhibitions and represented artists | ✅ |
| **Auction house** | "Auction" in the name or category (Auctioneers, Auction Galleries) | ✅ |
| **Art dealer** | An art dealer, a private dealer, "we buy and sell…", an antique shop that deals in fine art | ✅ |
| **Art advisor** | Art advisory and art consulting | ✅ |
| Not a buyer | Frame shops (unless the site shows exhibitions or represented artists), art-supply stores, paint-and-sip studios, art classes and schools, tattoo studios, print and copy shops, photographers, interior designers, furniture stores, house and mural painters, an artist's own studio, gift and craft shops, and anything that isn't about art | ❌ |
| Non-profit / museum | Museums, art centers, arts councils, public art, foundations, university and college galleries, non-profit art spaces. A commercial gallery in Houston's Museum District or on Santa Fe's Museum Hill is still a gallery | ❌ |

Most of the Not a buyer places and every non-profit are dropped before they are opened. A frame shop or studio that also calls itself a gallery is opened, because its website may show that it is one.

### The fields Varnish reads (leads.json)

Every art lead keeps the usual fields (`business_name`, `email`, `other_emails`, `contact_name`, `contact_role`, `phone`, `website`, `city`, `bundesland` (the state), `address`, `category`, `rating`, `review_count`, `instagram_url`, `maps_description`, `maps_url`, `country`, `country_name`, `campaign`, `observed_date`, and `relevance_tier` / `relevance_score` / `relevance_evidence`), and adds these. They come from the website once it is read, and from the Maps listing otherwise.

| Field | Values | What it means |
|---|---|---|
| `art_type` | `gallery`, `auction_house`, `dealer`, `art_advisor`, or `""` | The kind of buyer, from the tier. Empty for Not a buyer and Non-profit / museum. |
| `accepts_submissions` | `yes`, `no`, `unknown` | `no` when the site says it does not take artists' work ("we do not accept unsolicited submissions", "not currently accepting new artists", "unable to review portfolios", "submissions are closed", "please do not send portfolios", "by invitation only"…); `yes` with submission guidelines, an open call, "submit your work" or "artist submissions", or a submissions page. When both appear, `no` wins. |
| `submission_url` | an absolute URL, or `""` | The submissions / open-call page among the pages read or linked. It can be on another site (a Submittable form) or a PDF, and it is kept when that page says no, because it states the policy. |
| `accepts_consignments` | `yes`, `unknown` | `yes` when the site or listing talks about consigning, "sell your art", "selling with us", "we buy…", appraisals for a sale, or valuation and estimate requests. A refusal ("not accepting consignments") is `unknown`. |
| `consign_url` | an absolute URL, or `""` | The consign / sell-with-us page (or, failing that, "we buy" or valuation page). |
| `specialties` | `""` or words separated by `; ` | Lower case, from a fixed list (Varnish's own), in this order: contemporary; modern; post-war; impressionist; old masters; american art; african american art; latin american; asian art; african art; native american; western art; outsider art; folk art; photography; prints; sculpture; works on paper; ceramics; glass; design; decorative arts; emerging artists; israeli art; judaica. Always English, whatever the site's language. Only what the listing or site names: "near the Asian Art Museum" and "installation photography by…" don't count. |

Example (one row of `leads.json`; the WhatsApp, greeting and email columns are there too):

```json
{
  "business_name": "Hudson Line Gallery",
  "relevance_tier": "Gallery",
  "relevance_score": 99,
  "relevance_evidence": "gallery, current exhibitions (site), on view through (site), represented artists (site), the gallery represents (site)",
  "email": "info@hudsonlinegallery.com",
  "other_emails": "submissions@hudsonlinegallery.com",
  "website": "https://www.hudsonlinegallery.com/",
  "city": "New York",
  "bundesland": "NY",
  "art_type": "gallery",
  "accepts_submissions": "yes",
  "submission_url": "https://www.hudsonlinegallery.com/artist-submissions",
  "accepts_consignments": "unknown",
  "consign_url": "",
  "specialties": "contemporary; photography; sculpture; works on paper; emerging artists"
}
```

What it can't see: a policy that is only in an image, a PDF or a page the site doesn't link from its homepage, contact or submissions pages; a FAQ that answers "Do you accept submissions?" with a bare "No."; and sites that only work with JavaScript, unless they also hide their email (then Chrome reads them). Those rows say `unknown`.

- **The email and WhatsApp message** (`templates/art-email-en.txt`, `templates/art-whatsapp-en.txt`) are short and neutral: they introduce Varnish AI as a platform that refers sellers of artwork and ask whether the place may be listed. Varnish users write their own messages about each artwork, so the campaign is for the directory, not for mail-merge. Put your name and title in `"sender"` in `input.us-art.json`, and replace `[Postal address]` in the email before sending anything (see *A note on sending (US)*).

### Art buyers in Israel

```bash
npm run smoke:art:il     # Tel Aviv-Yafo only, 2 search terms, 10 places → output-il-art-smoke/
npm run art:il           # every Israeli art market → output-il-art/   (input.il-art.json)
npm run contacts -- output-il-art/leads.json --input input.il-art.json
```

Varnish imports **`output-il-art/leads.json`**, with the same fields and values as the US run (`country_name` is `Israel`; `bundesland` is empty, because Israeli addresses name no district).

- **Places:** Tel Aviv-Yafo first, district by district (Gordon Street, Florentin, Neve Tzedek, Old Jaffa, Jaffa Port, Kiryat HaMelacha, Ben Yehuda, Dizengoff); Jerusalem (Hutzot Hayotzer, Musrara, the German Colony, Talbiya, Ein Kerem, Mamilla); Haifa (Wadi Nisnas, the German Colony); Herzliya, Ramat Gan, Ra'anana, Kfar Saba, Netanya, Caesarea; the artists' villages and towns (Ein Hod, Safed's artists' quarter, Rosh Pina, Zikhron Ya'akov, Kiryat Tivon); Be'er Sheva, Eilat and Mitzpe Ramon. To run only some districts, set `"states"` (`TA JM HA CE NO SO`).
- **Search terms:** Hebrew first, one per kind of buyer in Hebrew and in English, across every place first: `גלריה לאמנות`, `Art gallery`, `בית מכירות פומביות`, `Auction house`, `סוחר אמנות`, `Art dealer`, `יועץ אמנות`, `Art advisor`; then `גלריה`, `אמנות ישראלית`, `מכירה פומבית`, `Art auction`, `Contemporary art gallery`.
- **Hebrew is read** in names, Maps descriptions and websites, with its prefixes (הגלריה, בגלריה): גלריה, בית מכירות פומביות, סוחרת אמנות, יועצת אמנות; frame shops (מסגרות) are not buyers unless the site shows exhibitions; museums, בית האמנים, municipal galleries, מתנ"סים and עמותות are non-profits (a בע"מ is not). Submissions: הגשת עבודות / קול קורא are `yes`, "איננו מקבלים הגשות" / "אין קבלת עבודות" / "סגור להגשות" are `no`. Consignments: מסירה למכירה, קבלת יצירות למכירה, "אנו קונים…", שמאות, הערכת שווי. Specialties are written in English ("אמנות ישראלית עכשווית" → `contemporary; israeli art`).
- **The email and WhatsApp message are in Hebrew** (`templates/art-email-he.txt`, `templates/art-whatsapp-he.txt`), written as the one-time request Israel's anti-spam law allows: "פרסומת" at the start of the subject (and of the WhatsApp text), and "השיבו 'הסר'" to opt out (see *A note on sending (Israel)*). Replace `[כתובת למשלוח דואר]` with your address before sending.

### Art buyers worldwide

```bash
npm run smoke:art:world  # London only, 2 search terms, 10 places → output-world-art-smoke/
npm run art:world        # 30 countries in one run → output-world-art/   (input.world-art.json)
npm run contacts -- output-world-art/leads.json --input input.world-art.json
```

Varnish imports **`output-world-art/leads.json`**, with the same fields and values as the US run. `country_name` is the English country name (`Japan`, `South Korea`, `United Arab Emirates`…), and `bundesland` is the state, province, prefecture or emirate when the address names one (`NSW`, `ON`, `SP`, `CDMX`, `Maharashtra`, `Dubai`, `Tokyo`…), otherwise empty.

- **Countries:** the United Kingdom, France, Germany, Switzerland, Italy, Spain, the Netherlands, Belgium, Austria, Sweden, Denmark, Norway, Ireland, Portugal, Monaco; Hong Kong, Singapore, Japan, South Korea, Taiwan, India, the United Arab Emirates; Australia, New Zealand; Canada, Mexico, Brazil, Argentina, Colombia; South Africa. The US and Israel have their own runs (above); mainland China is left out because Google Maps barely covers it.
- **Places:** 89 art cities, from London, Paris, Berlin and the fair cities (Basel, Maastricht, Venice, Hong Kong, Dubai…) to the resort towns where collectors buy (St. Moritz, Saint-Paul-de-Vence, Knokke, Monaco). The biggest markets are searched district by district: Mayfair, St James's, Shoreditch and Fitzrovia in London; Le Marais, Saint-Germain-des-Prés, Avenue Matignon and Drouot in Paris; Mitte, Kreuzberg and Charlottenburg in Berlin; Central and Wong Chuk Hang in Hong Kong; Ginza and Roppongi in Tokyo; Samcheong-dong and Hannam-dong in Seoul; Roma Norte and Polanco in Mexico City; Jardins in São Paulo; and more. To run only some countries, set `"states"` in `input.world-art.json`, e.g. `["UK", "FR", "JP"]` (codes: `UK FR DE CH IT ES NL BE AT SE DK NO IE PT MC HK SG JP KR TW IN AE AU NZ CA MX BR AR CO ZA`).
- **Search terms:** `Art gallery`, `Auction house`, `Art dealer`, `Art advisor` across every place first, then `Contemporary art gallery` and `Fine art gallery`: about 1,190 searches, several days. A restart carries on where it stopped; `--fresh` starts over.
- **Every search runs as its own country:** its Google region, its phone code (`+81`, `+55`…, with each country's trunk prefix and number lengths), its address format, and its country name. A result from another country in the run keeps that country (a Basel search finds Weil am Rhein, Germany); one from outside it (the US for a Vancouver search, Macau for Hong Kong) is dropped.
- **Names and websites are read in their own language:** Galerie, Galleria, Galería, Galleri, Galerij, ギャラリー, 画廊, 갤러리; Auktionshaus, Hôtel des ventes, casa d'aste, subastas, leilões, veilinghuis, オークション, 경매; Kunsthandel, marchand d'art; frame shops (Encadrement, Bilderrahmen, Cornici, 額縁) are not buyers; museums, Kunsthallen, Kunstvereine, foundations (Fondation, Fundación, Stiftung) and academies are non-profits. Submission and consignment wording is read in French, German, Italian, Spanish, Portuguese, Dutch, Japanese and Korean, and specialties are written in English.
- **The email and WhatsApp message** are the English art templates (`templates/art-email-en.txt`, `templates/art-whatsapp-en.txt`): a neutral opt-out line and `[Postal address]` for you to fill in, nothing US-only. Rules on unsolicited business email differ by country (Germany's UWG §7 is strict even for businesses); this isn't legal advice.

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
| `country` | `"DE"` | `"DE"` Germany, `"UK"` England, `"FR"` France, `"BE"` Belgium, `"US"` United States, `"IL"` Israel; for a campaign only, `"EU"` (Europe, sushi) and `"WORLD"` (30 countries, art). It sets the city list, search terms, phone code, contact pages and output folder. |
| `campaign` | Judaica | `"sushi"` looks for sushi restaurants instead: its own places, search terms, tiers, templates and folder. With `"country": "IL"` (Israel, `output-il-sushi/`) or `"country": "EU"` (all of Europe, `output-eu-sushi/`). `"art"` with `"country": "US"`, `"IL"` or `"WORLD"` builds Varnish AI's directory of galleries, auction houses, art dealers and art advisors (`output-us-art/`, `output-il-art/`, `output-world-art/`). |
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
npm test                                                               # 191 offline tests
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

## A note on sending (Israel)

Israel's anti-spam law (Communications Law, section 30A) covers email, SMS and messages like WhatsApp:
- **Consent first.** Advertising needs prior consent. One exception: you may contact a *business* once, to ask whether it wants to receive your offers. The Hebrew templates are written as that one-time request: "may we send you our catalogue?"
- **Label it.** The subject line starts with the word **"פרסומת"** (advertisement).
- **Identify yourself and let them refuse.** The message gives your name and contact details, and a way to opt out (the "השיבו 'הסר'" line). Remove anyone who replies "הסר" at once.
- **Don't follow up without consent.** Send each message once, by hand, and only follow up with shops that answered yes. Fines can be up to ₪1,000 per message without proof of damage.

This isn't legal advice.

## A note on sending (US)

**CAN-SPAM** allows business email without prior consent, provided that:
- the subject line is honest;
- the email gives your physical postal address (the Holon / Rishon LeZion / Tel Aviv addresses do this);
- it gives a clear way to opt out (the US template's last paragraph);
- you honour every opt-out within 10 business days.

Send WhatsApp messages one by one, by hand, as the links already do. This isn't legal advice.

The **art campaign's** email (Varnish AI) has the same opt-out line, but no postal address of its own: replace `[Postal address]` at the end of `templates/art-email-en.txt` with yours before you send it.

## A note on sending (England)

In the UK, **PECR** and **UK GDPR** apply. You may email a *company* (Ltd, LLP, plc) without prior consent if the message is relevant to its business and offers an easy opt-out. **Sole traders and partnerships** count as individuals, and they need consent first. Many small Judaica shops are sole traders, so treat "Ltd" in the Impressum/footer as the signal. As in Germany: send individually, honour opt-outs at once, and this isn't legal advice.

## A note on sending (Germany)

Cold email to businesses in Germany is regulated by **§ 7 UWG** and the GDPR. B2B email is generally allowed only where you can reasonably assume the recipient is interested. A shop that sells Judaica, receiving a relevant supplier offer, is a much stronger case than a random list, which is one reason the relevance filter exists. Even so:

- Send individually or in small batches, not as a bulk blast.
- Give a clear way to opt out and honour it at once.
- Keep the scraped data only as long as you need it for this outreach.

This is not legal advice. If you plan a large campaign, check with someone who knows German marketing law.
