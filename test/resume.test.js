import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadPrevious, readProgress, writeProgress, resumePoint, seedSeen, needsContactLookup, backupPrevious } from '../src/resume.js';
import { nameKey } from '../src/maps.js';

const queries = [
    { text: 'Judaica London', city: 'London' },
    { text: 'Judaica Golders Green, London', city: 'Golders Green, London' },
    { text: 'Judaica Manchester', city: 'Manchester' },
    { text: 'Jewish gift shop London', city: 'London' },
];

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'resume-')); }

test('a restart continues from progress.json when it matches this run', () => {
    assert.equal(resumePoint(queries, [], { country: 'UK', queries: 4, next: 3 }, 'UK'), 3);
    // A different country or query list means the file is about another run.
    assert.equal(resumePoint(queries, [], { country: 'DE', queries: 4, next: 3 }, 'UK'), 0);
    assert.equal(resumePoint(queries, [], { country: 'UK', queries: 99, next: 3 }, 'UK'), 0);
    // A finished run reports the end.
    assert.equal(resumePoint(queries, [], { country: 'UK', queries: 4, next: 4 }, 'UK'), 4);
});

test('without progress.json, it resumes at the last query that found a place', () => {
    // The run that stopped when the computer switched off had no progress file.
    const rows = [
        { business_name: 'Royal judaica', source_query: 'Judaica London' },
        { business_name: 'Divrei Kodesh', source_query: 'Judaica Manchester' },
    ];
    assert.equal(resumePoint(queries, rows, null, 'UK'), 2, 're-runs query 3, not query 1');
    assert.equal(resumePoint(queries, [], null, 'UK'), 0);
});

test('places already found are skipped by the resumed run', () => {
    const seen = seedSeen(new Set(), [{
        business_name: 'Hendon Judaica', city: 'London', phone: '+442082025770',
        maps_url: 'https://www.google.com/maps/place/x/data=!1s0x48761:0xabc', source_query: 'Judaica Golders Green, London',
    }], queries);
    assert.ok(seen.has('0x48761:0xabc'));
    assert.ok(seen.has('+442082025770'));
    assert.ok(seen.has(nameKey('Hendon Judaica', 'London')));
    assert.ok(seen.has(nameKey('Hendon Judaica', 'Golders Green, London')), 'district searches key by district');
});

test('only sites that may not have been read are looked up again', () => {
    assert.equal(needsContactLookup({ website: 'https://x.co.uk', email: '' }), true);
    assert.equal(needsContactLookup({ website: 'https://x.co.uk', email: '', contacts_checked: true }), false);
    assert.equal(needsContactLookup({ website: 'https://x.co.uk', email: 'a@x.co.uk' }), false);
    assert.equal(needsContactLookup({ website: '', email: '' }), false);
});

test('progress and previous results round-trip; --fresh keeps the old files', () => {
    const dir = tmp();
    assert.deepEqual(loadPrevious(dir), []);
    assert.equal(readProgress(dir), null);
    fs.writeFileSync(path.join(dir, 'leads.json'), JSON.stringify([{ business_name: 'A' }]));
    fs.writeFileSync(path.join(dir, 'judaica-leads.xlsx'), 'x');
    writeProgress(dir, { country: 'UK', queries: 4, next: 2 });
    assert.equal(loadPrevious(dir).length, 1);
    assert.equal(readProgress(dir).next, 2);

    const kept = backupPrevious(dir);
    assert.ok(fs.existsSync(path.join(kept, 'leads.json')));
    assert.ok(fs.existsSync(path.join(kept, 'judaica-leads.xlsx')));
    assert.ok(!fs.existsSync(path.join(dir, 'leads.json')), 'fresh run starts clean');
    assert.equal(backupPrevious(dir), null, 'nothing to keep the second time');
    fs.rmSync(dir, { recursive: true, force: true });
});
