/**
 * Picking a run back up after it stopped: a crash, a Ctrl-C, or the
 * computer switching off.
 *
 * Without this a restart began at query 1, and its first save (after ten
 * places) overwrote the leads.json and spreadsheet the stopped run had
 * already written. Now a restart loads the places already found, skips them,
 * and continues from the query it was on.
 *
 * Where it was is read from progress.json, written after every query. Runs
 * from before this existed have no progress file, so the position is
 * inferred from the last query that produced a place; that query is run
 * again, which is harmless because everything it finds is already known.
 */

import fs from 'node:fs';
import path from 'node:path';
import { placeKey, nameKey } from './maps.js';

export const PROGRESS_FILE = 'progress.json';

/** The rows a previous run saved, or [] when there are none. */
export function loadPrevious(outputDir) {
    const file = path.join(outputDir, 'leads.json');
    try {
        const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(rows) ? rows : [];
    } catch {
        return [];
    }
}

export function readProgress(outputDir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(outputDir, PROGRESS_FILE), 'utf8'));
    } catch {
        return null;
    }
}

export function writeProgress(outputDir, progress) {
    try {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, PROGRESS_FILE),
            JSON.stringify({ ...progress, updated: new Date().toISOString() }, null, 2), 'utf8');
    } catch { /* progress is a convenience; never fail a run over it */ }
}

/**
 * Index of the first query still to run.
 * @param {{text:string}[]} queries  this run's query list
 * @param {object[]} rows            places a previous run saved
 * @param {object|null} progress     its progress.json, if any
 * @param {string} country           this run's country code
 */
export function resumePoint(queries, rows, progress, country) {
    if (progress && progress.country === country && progress.queries === queries.length
        && Number.isInteger(progress.next)) {
        return Math.max(0, Math.min(progress.next, queries.length));
    }
    // No usable progress file: continue from the last query that found
    // something. Its own results are already in `rows`, so re-running it only
    // costs the one query.
    const index = new Map(queries.map((q, i) => [q.text, i]));
    let last = -1;
    for (const r of rows) {
        const i = index.get(r.source_query);
        if (i !== undefined && i > last) last = i;
    }
    return Math.max(0, last);
}

/** Mark every saved place as seen, so the resumed run skips it. */
export function seedSeen(seen, rows, queries = []) {
    const locOf = new Map(queries.map(q => [q.text, q.city]));
    for (const r of rows) {
        const pk = placeKey(r.maps_url);
        if (pk) seen.add(pk);
        if (r.phone) seen.add(r.phone);
        if (r.business_name) {
            seen.add(nameKey(r.business_name, r.city));
            // The run keyed names by the query's location, which for a
            // district search is "Golders Green, London" rather than the city.
            const loc = locOf.get(r.source_query);
            if (loc) seen.add(nameKey(r.business_name, loc));
        }
    }
    return seen;
}

/**
 * Saved places whose website lookup may not have happened: the run stopped
 * between finding them and reading their site. Worth one more look.
 */
export function needsContactLookup(row) {
    return !!row.website && !row.email && !row.contacts_checked;
}

/** Before a deliberate fresh start, keep the old results rather than overwrite them. */
export function backupPrevious(outputDir) {
    if (!fs.existsSync(path.join(outputDir, 'leads.json'))) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(outputDir, `previous-${stamp}`);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(outputDir)) {
        const src = path.join(outputDir, f);
        if (fs.statSync(src).isFile()) fs.renameSync(src, path.join(dest, f));
    }
    return dest;
}
