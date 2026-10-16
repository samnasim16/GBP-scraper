/**
 * Dedupe, sort, and write the deliverables.
 *
 *   output/judaica-leads.xlsx   Outreach · No email found · All results
 *   output/mail-merge.csv       one row per address: To, Subject, Body — ready
 *                               for Gmail/Outlook mail merge (YAMM, GMass, Word)
 *   output/leads.csv / .json    every scraped row
 *
 * Saving happens repeatedly during a run, not just at the end, so a crash or a
 * Ctrl-C never wipes out collected leads.
 */

import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { placeKey } from './maps.js';
import { isTarget, TARGET_TIERS } from './relevance.js';
import { greetingFor, shortBusinessName } from './contacts.js';
import { classifyWhatsApp, whatsappLink, loadWhatsAppTemplate } from './whatsapp.js';
import { renderEmail } from './email-template.js';

export const COLUMNS = [
    ['business_name',      'Business Name',     34],
    ['relevance_tier',     'Relevance',         22],
    ['relevance_score',    'Score',              8],
    ['whatsapp_status',    'WhatsApp',          30],
    ['whatsapp_number',    'WhatsApp Number',   17],
    ['whatsapp_link',      'WhatsApp Chat',     18],
    ['email',              'Email',             32],
    ['greeting',           'Greeting',          28],
    ['contact_name',       'Contact Person',    24],
    ['contact_role',       'Role',              16],
    ['phone',              'Phone',             18],
    ['website',            'Website',           34],
    ['city',               'City',              16],
    ['bundesland',         'State',              7],
    ['address',            'Address',           38],
    ['category',           'Category',          24],
    ['rating',             'Rating',             7],
    ['review_count',       'Reviews',            8],
    ['other_emails',       'Other Emails',      34],
    ['facebook_url',       'Facebook',          34],
    ['instagram_url',      'Instagram',         34],
    ['relevance_evidence', 'Why it matched',    34],
    ['maps_description',   'Maps Description',  40],
    ['hours_summary',      'Hours',             30],
    ['email_subject',      'Email Subject',     40],
    ['email_body',         'Email Body',        60],
    ['outreach_status',    'Outreach Status',   16],
    ['maps_url',           'Maps URL',          40],
    ['source_query',       'Source Query',      28],
    ['observed_date',      'Date Scraped',      12],
];
export const CSV_COLUMNS = COLUMNS.map(c => c[0]);

const LINK_COLUMNS = ['website', 'facebook_url', 'instagram_url', 'maps_url'];

/**
 * Escape a CSV field. Also neutralises spreadsheet formula injection: a cell
 * starting with =, +, - or @ is executed by Excel, and text from the open web
 * is not trustworthy input.
 */
export function escapeCSV(val) {
    let s = String(val ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCSV(rows, columns = CSV_COLUMNS, { flat = false } = {}) {
    const header = columns.join(',');
    const cell = flat ? flatCell : (v) => v;
    const lines = rows.map(r => columns.map(c => escapeCSV(cell(r[c]))).join(','));
    return '\ufeff' + [header, ...lines].join('\n');   // BOM so Excel reads umlauts
}

// leads.csv is one line per place: line breaks inside a cell made Excel show
// every row as a tall block with blank-looking gaps. The full email body is in
// mail-merge.csv and the workbook, so it is left out here.
export const LEADS_CSV_COLUMNS = CSV_COLUMNS.filter(c => c !== 'email_body');

/** One-line cell: Maps' private-use icon glyphs dropped, whitespace collapsed. */
function flatCell(v) {
    if (v == null || typeof v !== 'string') return v;
    return v.replace(/[\uE000-\uF8FF]/g, ' ').replace(/\s*[\r\n]+\s*/g, ' · ').replace(/[ \t]{2,}/g, ' ').replace(/\s+·\s*(·\s*)+/g, ' · ')
        .replace(/\b([ap]m)(?=\d)/g, '$1, ').replace(/\s+;/g, ';').trim();   // Maps hours: '2 pm4–7 pm'
}

/** Dedupe by place id, then by website domain + city; best relevance first. */
export function prepareLeads(leads, { template = null, sender = {}, whatsappTemplate = loadWhatsAppTemplate() } = {}) {
    const sorted = (leads || []).filter(Boolean).slice().sort((a, b) =>
        (tierRank(a.relevance_tier) - tierRank(b.relevance_tier))
        || ((b.relevance_score || 0) - (a.relevance_score || 0))
        || ((b.email ? 1 : 0) - (a.email ? 1 : 0))
        || ((b.review_count || 0) - (a.review_count || 0)));

    const seen = new Set();
    const out = [];
    for (const l of sorted) {
        // Name + city catches the same place reached through two Maps URLs
        // (a sponsored and an organic listing) with no phone to match on.
        const nameCity = `nc:${String(l.business_name || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')}|${String(l.city || '').toLowerCase()}`;
        const keys = [placeKey(l.maps_url), l.phone && `tel:${l.phone}`, l.business_name && nameCity].filter(Boolean);
        if (keys.some(k => seen.has(k))) continue;
        keys.forEach(k => seen.add(k));
        const row = { ...l };
        delete row._siteText;
        row.greeting = greetingFor(row);
        if (template) {
            const e = renderEmail(row, template, sender);
            row.email_subject = e.subject;
            row.email_body = e.body;
        }
        const wa = classifyWhatsApp(row);
        row.whatsapp_status = wa.status;
        row.whatsapp_number = wa.number;
        row.whatsapp_priority = wa.priority;
        row.whatsapp_link = wa.number && wa.priority < 4
            ? whatsappLink(wa.number, fillWhatsApp(whatsappTemplate, row, sender)) : '';
        out.push(row);
    }
    // WhatsApp first: among the likely buyers (the top two tiers), shops with
    // WhatsApp come before the rest, then by tier and score as before.
    const group = (r) => (tierRank(r.relevance_tier) < 2 ? 0 : 1);
    return out
        .map((r, i) => ({ r, i }))
        .sort((a, b) => (group(a.r) - group(b.r))
            || (group(a.r) === 0 ? (a.r.whatsapp_priority - b.r.whatsapp_priority) : 0)
            || (a.i - b.i))
        .map(x => x.r);
}

function fillWhatsApp(text, row, sender) {
    if (!text) return '';
    const vars = {
        ...row,
        shop_name: shortBusinessName(row.business_name) || row.business_name,
        sender_name: sender.name || '[Your Name]',
        sender_title: sender.title || '[Title]',
    };
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

function tierRank(t) {
    const i = TARGET_TIERS.indexOf(t);
    return i === -1 ? TARGET_TIERS.length : i;
}

/**
 * One mail-merge row per ADDRESS among the targets. Chains list every branch
 * (Shefa Mehadrin in Manchester and London, both info@shefamehadrin.co.uk);
 * the shop should get the email once, not once per branch.
 */
export function buildMailMerge(rows, includeTiers) {
    const cols = ['email', 'greeting', 'contact_name', 'business_name', 'city', 'website', 'whatsapp_status', 'whatsapp_number', 'email_subject', 'email_body'];
    return buildCSV(uniqueByEmail(rows.filter(r => r.email && isTarget(r, includeTiers))), cols);
}

/** Keep the first (best-ranked) row for each address. */
export function uniqueByEmail(rows) {
    const seen = new Set();
    return rows.filter(r => {
        const key = String(r.email || '').toLowerCase();
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// Workbook palette: a navy header, one soft colour per relevance tier and per
// WhatsApp status, light grid lines, and one fixed-height line per place.
const XL = {
    font: 'Calibri',
    header: { fill: 'FF1F3864', font: 'FFFFFFFF' },
    border: 'FFD9DEE5',
    link: 'FF1155CC',
    chat: 'FF128C7E',
    band: 'FFF8F9FB',
    tier: {
        'Judaica seller':          { fill: 'FFC6EFCE', font: 'FF006100' },
        'Jewish / Israeli retail': { fill: 'FFDDEBF7', font: 'FF1F4E79' },
        'Glass & gift shop':       { fill: 'FFFFEB9C', font: 'FF7F6000' },
        'Unrelated':               { fill: 'FFEDEDED', font: 'FF595959' },
        'Not a retailer':          { fill: 'FFEDEDED', font: 'FF595959' },
        'Non-profit / religious':  { fill: 'FFFCE4D6', font: 'FF833C0B' },
    },
    whatsapp: {
        1: { fill: 'FFC6EFCE', font: 'FF006100' },
        2: { fill: 'FFFFEB9C', font: 'FF7F6000' },
        3: { fill: 'FFEDEDED', font: 'FF404040' },
    },
    tabs: { 'WhatsApp': 'FF25D366', 'Outreach': 'FF1F3864', 'No email found': 'FFBF8F00', 'All results': 'FF7F7F7F' },
};

const solid = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

/** Write sheets ([title, rows] pairs) as one styled workbook. */
export async function writeWorkbook(file, sheets) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Jaffa Glass';
    const thin = { style: 'thin', color: { argb: XL.border } };
    const grid = { top: thin, left: thin, bottom: thin, right: thin };
    for (const [title, data] of sheets) {
        const ws = wb.addWorksheet(title, {
            views: [{ state: 'frozen', ySplit: 1, xSplit: 1, zoomScale: 100 }],
            properties: { tabColor: { argb: XL.tabs[title] || 'FF1F3864' }, defaultRowHeight: 18 },
        });
        ws.columns = COLUMNS.map(([key, header, width]) => ({ key, header, width }));
        data.forEach((r, i) => {
            const row = ws.addRow(r);
            row.height = 18;
            row.font = { name: XL.font, size: 10 };
            row.eachCell({ includeEmpty: true }, (cell) => {
                cell.border = grid;
                cell.alignment = { vertical: 'middle', wrapText: false };
                if (i % 2) cell.fill = solid(XL.band);
            });
            for (const col of LINK_COLUMNS) {
                const cell = row.getCell(col);
                const v = String(cell.value || '');
                if (/^https?:\/\//i.test(v)) {
                    cell.value = { text: v, hyperlink: v };
                    cell.font = { name: XL.font, size: 10, color: { argb: XL.link }, underline: true };
                }
            }
            const mail = row.getCell('email');
            if (mail.value) {
                const subj = encodeURIComponent(r.email_subject || '');
                const body = encodeURIComponent(r.email_body || '').slice(0, 1800);
                mail.value = { text: String(r.email), hyperlink: `mailto:${r.email}?subject=${subj}&body=${body}` };
                mail.font = { name: XL.font, size: 10, color: { argb: XL.link }, underline: true };
            }
            const chat = row.getCell('whatsapp_link');
            if (r.whatsapp_link) {
                chat.value = { text: 'Open chat', hyperlink: r.whatsapp_link };
                chat.font = { name: XL.font, size: 10, bold: true, color: { argb: XL.chat }, underline: true };
                chat.alignment = { vertical: 'middle', horizontal: 'center' };
            }
            const tier = XL.tier[r.relevance_tier];
            if (tier) {
                const c = row.getCell('relevance_tier');
                c.fill = solid(tier.fill);
                c.font = { name: XL.font, size: 10, bold: true, color: { argb: tier.font } };
            }
            const wa = XL.whatsapp[r.whatsapp_priority];
            if (wa) {
                const c = row.getCell('whatsapp_status');
                c.fill = solid(wa.fill);
                c.font = { name: XL.font, size: 10, color: { argb: wa.font } };
            }
            row.getCell('business_name').font = { name: XL.font, size: 10, bold: true };
            for (const key of ['relevance_score', 'rating', 'review_count', 'bundesland']) {
                row.getCell(key).alignment = { vertical: 'middle', horizontal: 'center' };
            }
            row.getCell('rating').numFmt = '0.0';
        });
        const head = ws.getRow(1);
        head.height = 26;
        head.eachCell((cell) => {
            cell.fill = solid(XL.header.fill);
            cell.font = { name: XL.font, size: 10, bold: true, color: { argb: XL.header.font } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = grid;
        });
        ws.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } };
    }
    await wb.xlsx.writeFile(file);
}

async function writeXlsx(rows, file, includeTiers) {
    const targets = rows.filter(r => isTarget(r, includeTiers));
    await writeWorkbook(file, [
        // Everyone worth a WhatsApp message, best evidence first.
        ['WhatsApp', targets.filter(r => r.whatsapp_priority < 4)],
        ['Outreach', uniqueByEmail(targets.filter(r => r.email))],
        ['No email found', targets.filter(r => !r.email)],
        ['All results', rows],
    ]);
}

/**
 * Create a saver bound to an output directory. Serialised so overlapping
 * writes can't clobber each other.
 */
export function createSaver(outputDir, { template = null, sender = {}, includeTiers, whatsappTemplate, log = console.log } = {}) {
    fs.mkdirSync(outputDir, { recursive: true });
    let saving = false;

    return async function saveResults(leads, { quiet = false } = {}) {
        if (saving) return;
        saving = true;
        try {
            const rows = prepareLeads(leads, { template, sender, ...(whatsappTemplate !== undefined ? { whatsappTemplate } : {}) });
            fs.writeFileSync(path.join(outputDir, 'leads.csv'), buildCSV(rows, LEADS_CSV_COLUMNS, { flat: true }), 'utf8');
            fs.writeFileSync(path.join(outputDir, 'leads.json'), JSON.stringify(rows, null, 2), 'utf8');
            fs.writeFileSync(path.join(outputDir, 'mail-merge.csv'), buildMailMerge(rows, includeTiers), 'utf8');
            try {
                await writeXlsx(rows, path.join(outputDir, 'judaica-leads.xlsx'), includeTiers);
            } catch (e) {
                if (!quiet) log(`⚠️  XLSX write skipped (${e.message}) — CSV still saved.`);
            }
            if (!quiet) {
                const t = rows.filter(r => isTarget(r, includeTiers));
                const wa = t.filter(r => r.whatsapp_priority === 1).length;
                log(`   💾 Saved ${rows.length} places (${t.length} targets, ${t.filter(r => r.email).length} with email, ${wa} with WhatsApp) → ${path.basename(outputDir)}/`);
            }
        } catch (e) {
            console.error(`   ⚠️  Save failed: ${e.message}`);
        } finally {
            saving = false;
        }
    };
}
