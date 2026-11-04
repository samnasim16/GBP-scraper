/**
 * The clean output: a client-ready workbook and CSV of the targets only.
 *
 *   Sushi_Restaurants_Germany.xlsx   Summary · All restaurants · Email list
 *   Sushi_Restaurants_Germany.csv    one line per place, readable headers
 *
 * No scores, match reasons or email text: name, place, rating, how to reach
 * them. Written by the saver alongside the full workbook whenever a profile
 * (or the input file) asks for it with `clean`.
 */

import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { shortBusinessName } from './contacts.js';
import { buildCSV } from './output.js';

// Landline area codes worth spacing out; mobiles (015x–017x) always are.
const DE_AREA = ['30', '40', '89', '221', '69', '211', '711', '341', '231', '911', '201', '511', '421', '351', '228', '621', '721', '821', '611', '6131', '761', '6221', '431', '241', '941', '234', '202', '521', '251'];

/** "+4922133178190" → "+49 221 33178190"; other countries "+<code> <rest>". */
export function prettyPhone(phone, phoneCode = '') {
    const d = String(phone || '').replace(/^'/, '');
    if (!d.startsWith('+')) return d;
    if (d.startsWith('+49')) {
        const mob = d.match(/^\+49(1[5-7]\d)(\d+)$/);
        if (mob) return `+49 ${mob[1]} ${mob[2]}`;
        const code = DE_AREA.find(a => d.slice(3).startsWith(a));
        return code ? `+49 ${code} ${d.slice(3 + code.length)}` : `+49 ${d.slice(3)}`;
    }
    return phoneCode && d.slice(1).startsWith(phoneCode) ? `+${phoneCode} ${d.slice(1 + phoneCode.length)}` : d;
}

const waLabel = (s) => (/^Yes/.test(s) ? 'Yes' : /^Likely/.test(s) ? 'Likely' : /^Check/.test(s) ? 'Check' : '—');

/** The Maps name without its SEO tail or a booking note: "Lụa Restaurant (online reservieren auf Website)". */
export function cleanName(name) {
    return (shortBusinessName(name) || String(name || ''))
        .replace(/\s*\((?=[^)]*(online|website|reserv|bestell|liefer|order|delivery))[^)]*\)\s*$/i, '').trim();
}

/** Rows for the clean output, grouped by place (biggest first), most-reviewed first. */
export function cleanRows(targets) {
    const rows = targets.map(r => ({
        name: cleanName(r.business_name),
        city: r.city || '',
        country: r.country_name || '',
        address: r.address || '',
        rating: r.rating === '' || r.rating == null ? null : Number(r.rating),
        reviews: Number(r.review_count) || 0,
        email: r.email || '',
        phone: prettyPhone(r.phone, r.phone_code),
        whatsapp: waLabel(r.whatsapp_status),
        chat: r.whatsapp_link || '',
        website: r.website || '',
        instagram: r.instagram_url || '',
        contact: r.contact_name || '',
        maps: r.maps_url || '',
    }));
    const multiCountry = new Set(rows.map(r => r.country)).size > 1;
    const groupOf = (r) => (multiCountry ? r.country : r.city);
    const size = {};
    for (const r of rows) size[groupOf(r)] = (size[groupOf(r)] || 0) + 1;
    rows.sort((a, b) => ((size[groupOf(b)] - size[groupOf(a)]) || groupOf(a).localeCompare(groupOf(b)))
        || (multiCountry && a.city.localeCompare(b.city)) || (b.reviews - a.reviews));
    return { rows, multiCountry, groups: Object.keys(size).sort((a, b) => size[b] - size[a] || a.localeCompare(b)), groupOf };
}

const NAVY = 'FF1F3864', BAND = 'FFF3F6FA', BORDER = 'FFD9DEE5', LINK = 'FF1155CC', GREEN = 'FF128C7E';
const solid = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = { style: 'thin', color: { argb: BORDER } };
const grid = { top: thin, left: thin, bottom: thin, right: thin };
const WA_FILL = { Yes: ['FFC6EFCE', 'FF006100'], Likely: ['FFFFEB9C', 'FF7F6000'], Check: ['FFEDEDED', 'FF404040'] };

/**
 * Write <file>.xlsx and <file>.csv into `dir`.
 * @param {object[]} targets  prepared rows (prepareLeads) that are outreach targets
 * @param {{file:string, title:string, noun?:string}} opts
 */
export async function writeCleanOutput(targets, dir, { file, title, noun = 'Places' }) {
    const { rows, multiCountry, groups, groupOf } = cleanRows(targets);
    const seen = new Set();
    const emailRows = rows.filter(r => r.email && !seen.has(r.email.toLowerCase()) && seen.add(r.email.toLowerCase()));
    const COLS = [
        ['n', '#', 5], ['name', noun.replace(/s$/, ''), 32], ['city', 'City', 14],
        ...(multiCountry ? [['country', 'Country', 14]] : []),
        ['address', 'Address', 40], ['rating', 'Rating', 8], ['reviews', 'Reviews', 9], ['email', 'Email', 32],
        ['phone', 'Phone', 18], ['whatsapp', 'WhatsApp', 10], ['chat', 'WhatsApp chat', 14], ['website', 'Website', 30],
        ['instagram', 'Instagram', 26], ['contact', 'Contact person', 22], ['maps', 'Google Maps', 14],
    ];

    const wb = new ExcelJS.Workbook();
    wb.creator = 'JaffaGlass';

    // Summary: one line per city (or per country on a many-country run).
    const sum = wb.addWorksheet('Summary', { properties: { tabColor: { argb: NAVY } }, views: [{ showGridLines: false }] });
    sum.columns = [{ width: 3 }, { width: 22 }, { width: 14 }, { width: 12 }, { width: 16 }, { width: 12 }];
    sum.getCell('B2').value = title;
    sum.getCell('B2').font = { name: 'Calibri', size: 18, bold: true, color: { argb: NAVY } };
    sum.getCell('B3').value = `Google Maps · ${new Date().toISOString().slice(0, 10)}`;
    sum.getCell('B3').font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF595959' } };
    const hr = sum.getRow(5);
    [multiCountry ? 'Country' : 'City', noun, 'With email', 'WhatsApp (Yes)', 'Avg. rating'].forEach((h, i) => {
        const c = hr.getCell(i + 2);
        c.value = h; c.fill = solid(NAVY); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { horizontal: 'center' }; c.border = grid;
    });
    const stat = (list) => {
        const rated = list.filter(r => r.rating);
        return [list.length, list.filter(r => r.email).length, list.filter(r => r.whatsapp === 'Yes').length,
            rated.length ? Math.round(rated.reduce((s, r) => s + r.rating, 0) / rated.length * 10) / 10 : null];
    };
    let line = 6;
    for (const g of groups) {
        const row = sum.getRow(line);
        [g || '?', ...stat(rows.filter(r => groupOf(r) === g))].forEach((v, i) => {
            const c = row.getCell(i + 2);
            c.value = v; c.border = grid; c.alignment = { horizontal: i ? 'center' : 'left' };
            if (line % 2) c.fill = solid(BAND);
        });
        line++;
    }
    const tot = sum.getRow(line);
    ['Total', ...stat(rows)].forEach((v, i) => {
        const c = tot.getCell(i + 2);
        c.value = v; c.font = { bold: true }; c.border = grid; c.alignment = { horizontal: i ? 'center' : 'left' }; c.fill = solid('FFDDEBF7');
    });
    const note = (r, text) => { const c = sum.getCell(`B${r}`); c.value = text; c.font = { size: 10, color: { argb: 'FF404040' } }; };
    note(line + 2, `${emailRows.length} unique email addresses (chains share one inbox): see the "Email list" sheet.`);
    note(line + 3, 'WhatsApp: Yes = WhatsApp link on the website or Google listing · Likely = mobile number · Check = landline (may have WhatsApp Business).');

    const sheet = (name, data, tab) => {
        const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: tab } }, views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
        ws.columns = COLS.map(([key, header, width]) => ({ key, header, width }));
        data.forEach((r, i) => {
            const row = ws.addRow({ ...r, n: i + 1, chat: '', maps: '' });
            row.height = 18;
            row.eachCell({ includeEmpty: true }, (c) => {
                c.border = grid; c.alignment = { vertical: 'middle' }; c.font = { name: 'Calibri', size: 10 };
                if (i % 2) c.fill = solid(BAND);
            });
            row.getCell('name').font = { name: 'Calibri', size: 10, bold: true };
            for (const k of ['n', 'rating', 'reviews', 'whatsapp']) row.getCell(k).alignment = { vertical: 'middle', horizontal: 'center' };
            row.getCell('rating').numFmt = '0.0';
            row.getCell('reviews').numFmt = '#,##0';
            const link = (key, url, text) => {
                if (!url) return;
                const c = row.getCell(key);
                c.value = { text, hyperlink: url };
                c.font = { name: 'Calibri', size: 10, color: { argb: key === 'chat' ? GREEN : LINK }, underline: true, bold: key === 'chat' };
            };
            if (r.email) link('email', `mailto:${r.email}`, r.email);
            link('website', r.website, r.website.replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, ''));
            link('instagram', r.instagram, r.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//, '@').replace(/[/?].*$/, ''));
            link('chat', r.chat, 'Open chat');
            link('maps', r.maps, 'Open map');
            const w = WA_FILL[r.whatsapp];
            if (w) {
                const c = row.getCell('whatsapp');
                c.fill = solid(w[0]); c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: w[1] } };
            }
        });
        const h = ws.getRow(1);
        h.height = 24;
        h.eachCell((c) => {
            c.fill = solid(NAVY); c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            c.alignment = { vertical: 'middle', horizontal: 'center' }; c.border = grid;
        });
        ws.autoFilter = { from: 'A1', to: { row: 1, column: COLS.length } };
    };
    sheet(`All ${noun.toLowerCase()}`, rows, 'FF2E75B6');
    sheet('Email list', emailRows, 'FF548235');

    fs.mkdirSync(dir, { recursive: true });
    await wb.xlsx.writeFile(path.join(dir, `${file}.xlsx`));
    const csvCols = COLS.map(c => c[0]).filter(k => !['n', 'chat'].includes(k));
    fs.writeFileSync(path.join(dir, `${file}.csv`),
        buildCSV(rows, csvCols, { flat: true, headers: Object.fromEntries(COLS.map(([k, h]) => [k, h])) }), 'utf8');
    return { rows: rows.length, emails: emailRows.length };
}
