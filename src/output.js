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
import { greetingFor } from './contacts.js';
import { renderEmail } from './email-template.js';

export const COLUMNS = [
    ['business_name',      'Business Name',     34],
    ['relevance_tier',     'Relevance',         22],
    ['relevance_score',    'Score',              8],
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

export function buildCSV(rows, columns = CSV_COLUMNS) {
    const header = columns.join(',');
    const lines = rows.map(r => columns.map(c => escapeCSV(r[c])).join(','));
    return '﻿' + [header, ...lines].join('\n');   // BOM so Excel reads umlauts
}

/** Dedupe by place id, then by website domain + city; best relevance first. */
export function prepareLeads(leads, { template = null, sender = {} } = {}) {
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
        out.push(row);
    }
    return out;
}

function tierRank(t) {
    const i = TARGET_TIERS.indexOf(t);
    return i === -1 ? TARGET_TIERS.length : i;
}

/** One mail-merge row per lead that has an address and is a target. */
export function buildMailMerge(rows, includeTiers) {
    const cols = ['email', 'greeting', 'contact_name', 'business_name', 'city', 'website', 'email_subject', 'email_body'];
    const targets = rows.filter(r => r.email && isTarget(r, includeTiers));
    return buildCSV(targets, cols);
}

async function writeXlsx(rows, file, includeTiers) {
    const wb = new ExcelJS.Workbook();
    const targets = rows.filter(r => isTarget(r, includeTiers));
    const sheets = [
        ['Outreach', targets.filter(r => r.email)],
        ['No email found', targets.filter(r => !r.email)],
        ['All results', rows],
    ];
    for (const [title, data] of sheets) {
        const ws = wb.addWorksheet(title, { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
        ws.columns = COLUMNS.map(([key, header, width]) => ({ key, header, width }));
        for (const r of data) {
            const row = ws.addRow(r);
            for (const col of LINK_COLUMNS) {
                const cell = row.getCell(col);
                const v = String(cell.value || '');
                if (/^https?:\/\//i.test(v)) {
                    cell.value = { text: v, hyperlink: v };
                    cell.font = { color: { argb: 'FF1155CC' }, underline: true };
                }
            }
            const mail = row.getCell('email');
            if (mail.value) {
                const subj = encodeURIComponent(r.email_subject || '');
                const body = encodeURIComponent(r.email_body || '').slice(0, 1800);
                mail.value = { text: String(r.email), hyperlink: `mailto:${r.email}?subject=${subj}&body=${body}` };
                mail.font = { color: { argb: 'FF1155CC' }, underline: true };
            }
            row.getCell('email_body').alignment = { wrapText: false, vertical: 'top' };
        }
        ws.getRow(1).font = { bold: true };
        ws.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } };
    }
    await wb.xlsx.writeFile(file);
}

/**
 * Create a saver bound to an output directory. Serialised so overlapping
 * writes can't clobber each other.
 */
export function createSaver(outputDir, { template = null, sender = {}, includeTiers, log = console.log } = {}) {
    fs.mkdirSync(outputDir, { recursive: true });
    let saving = false;

    return async function saveResults(leads, { quiet = false } = {}) {
        if (saving) return;
        saving = true;
        try {
            const rows = prepareLeads(leads, { template, sender });
            fs.writeFileSync(path.join(outputDir, 'leads.csv'), buildCSV(rows), 'utf8');
            fs.writeFileSync(path.join(outputDir, 'leads.json'), JSON.stringify(rows, null, 2), 'utf8');
            fs.writeFileSync(path.join(outputDir, 'mail-merge.csv'), buildMailMerge(rows, includeTiers), 'utf8');
            try {
                await writeXlsx(rows, path.join(outputDir, 'judaica-leads.xlsx'), includeTiers);
            } catch (e) {
                if (!quiet) log(`⚠️  XLSX write skipped (${e.message}) — CSV still saved.`);
            }
            if (!quiet) {
                const t = rows.filter(r => isTarget(r, includeTiers));
                log(`   💾 Saved ${rows.length} places (${t.length} targets, ${t.filter(r => r.email).length} with email) → output/`);
            }
        } catch (e) {
            console.error(`   ⚠️  Save failed: ${e.message}`);
        } finally {
            saving = false;
        }
    };
}
