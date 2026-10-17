/**
 * Render the outreach email for one lead.
 *
 * The template lives in templates/partnership-email.txt so it can be edited
 * without touching code. Its first line is "Subject: …"; everything after the
 * blank line is the body. Placeholders are {{like_this}} and may be any lead
 * field plus greeting, shop_name, sender_name and sender_title.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { greetingFor, shortBusinessName } from './contacts.js';

export const DEFAULT_TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'partnership-email.txt');

export function loadTemplate(file = DEFAULT_TEMPLATE_PATH) {
    const raw = fs.readFileSync(path.resolve(file), 'utf8').replace(/\r\n/g, '\n');
    const m = raw.match(/^Subject:\s*(.+)\n\s*\n([\s\S]*)$/);
    if (!m) throw new Error(`${file}: the first line must be "Subject: …" followed by a blank line`);
    return { subject: m[1].trim(), body: m[2].replace(/\s+$/, '') + '\n' };
}

function fill(text, vars) {
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

/**
 * @param {object} lead
 * @param {{subject:string, body:string}} template
 * @param {{name?:string, title?:string}} sender
 */
export function renderEmail(lead, template, sender = {}) {
    const vars = {
        ...lead,
        greeting: greetingFor(lead),
        shop_name: shortBusinessName(lead.business_name) || lead.business_name,
        sender_name: sender.name || '[Your Name]',
        sender_title: sender.title || '[Title]',
    };
    return { subject: fill(template.subject, vars), body: fill(template.body, vars) };
}
