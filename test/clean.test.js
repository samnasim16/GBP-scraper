import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

import { prettyPhone, cleanName, cleanRows, writeCleanOutput } from '../src/clean.js';
import { createSaver } from '../src/output.js';
import { resolveCountry } from '../src/config.js';

const place = (business_name, city, extra = {}) => ({
    business_name, city, country_name: 'Germany', address: `Str. 1, 10115 ${city}`, rating: 4.5, review_count: 100,
    relevance_tier: 'Sushi place', relevance_score: 80, phone: '+493012345678', phone_code: '49',
    maps_url: `https://www.google.com/maps/place/${encodeURIComponent(business_name)}`, campaign: 'sushi', country: 'DE', ...extra,
});

test('clean output: readable phones and names', () => {
    assert.equal(prettyPhone('+4922133178190', '49'), '+49 221 33178190');
    assert.equal(prettyPhone('+4917656393139', '49'), '+49 176 56393139');
    assert.equal(prettyPhone("'+493026103656", '49'), '+49 30 26103656');
    assert.equal(prettyPhone('+351211234567', '351'), '+351 211234567');
    assert.equal(prettyPhone('', '49'), '');
    assert.equal(cleanName('Lụa Restaurant (online reservieren auf Website)'), 'Lụa Restaurant');
    assert.equal(cleanName('Sushi Ninja | Best Sushi in Köln'), 'Sushi Ninja');
    assert.equal(cleanName('Sushi for Friends (Barmbek)'), 'Sushi for Friends (Barmbek)');
});

test('clean output: biggest city first, most-reviewed first; a many-country run groups by country', () => {
    const { rows, groups, multiCountry } = cleanRows([
        place('A', 'Köln', { review_count: 5 }), place('B', 'Berlin', { review_count: 50 }),
        place('C', 'Berlin', { review_count: 500 }), place('D', 'Köln', { review_count: 9 }), place('E', 'Berlin'),
    ]);
    assert.equal(multiCountry, false);
    assert.deepEqual(groups, ['Berlin', 'Köln']);
    assert.deepEqual(rows.map(r => r.name), ['C', 'E', 'B', 'D', 'A']);
    const eu = cleanRows([place('X', 'Lisboa', { country_name: 'Portugal' }), place('Y', 'Berlin'), place('Z', 'Köln')]);
    assert.equal(eu.multiCountry, true);
    assert.deepEqual(eu.groups, ['Germany', 'Portugal']);
});

test('clean output: the saver writes it with every save — summary, all places, one row per email', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-'));
    const input = JSON.parse(fs.readFileSync(new URL('../input.germany-sushi.json', import.meta.url), 'utf8'));
    const C = resolveCountry(input);
    const leads = [
        place('Yoko Sushi Köln', 'Köln', { email: 'info@yoko.de', whatsapp_site_numbers: '+4917612345678' }),
        place('Yoko Sushi Berlin', 'Berlin', { email: 'info@yoko.de', phone: '+493099999999' }),
        place('Aiko', 'Berlin', { phone: '+493088888888' }),
        place('Udon House', 'Berlin', { relevance_tier: 'Japanese / Asian restaurant', phone: '+493077777777' }),
    ];
    await createSaver(dir, { includeTiers: input.includeTiers, workbook: input.workbook,
        clean: { ...C.clean, file: input.cleanFile, title: input.cleanTitle }, log: () => {} })(leads);
    const csv = fs.readFileSync(path.join(dir, 'Sushi_Restaurants_Germany.csv'), 'utf8').replace(/^﻿/, '').split('\n');
    assert.equal(csv[0], 'Restaurant,City,Address,Rating,Reviews,Email,Phone,WhatsApp,Website,Instagram,Contact person,Google Maps');
    assert.equal(csv.length, 4, 'sushi places only');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(dir, 'Sushi_Restaurants_Germany.xlsx'));
    assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'All restaurants', 'Email list']);
    assert.equal(wb.getWorksheet('Summary').getCell('B2').value, 'Sushi restaurants in Germany');
    assert.equal(wb.getWorksheet('All restaurants').rowCount, 4);
    assert.equal(wb.getWorksheet('Email list').rowCount, 2, 'a chain sharing one inbox is emailed once');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('clean output: every sushi run writes it', () => {
    for (const input of [{ country: 'IL', campaign: 'sushi' }, { country: 'EU', campaign: 'sushi' }]) {
        const c = resolveCountry(input);
        assert.ok(c.clean && c.clean.file && c.clean.title, input.country);
    }
    assert.equal(resolveCountry({ country: 'DE' }).clean, undefined, 'Judaica runs are unchanged');
});
