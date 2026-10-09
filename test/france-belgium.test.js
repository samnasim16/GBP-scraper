import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCountry, resolveLocations, buildQueryMatrix } from '../src/config.js';
import { pickCity, mapsSearchUrl } from '../src/maps.js';
import { scoreRelevance, isSellable, isTarget } from '../src/relevance.js';
import { extractContact, greetingFor, rankEmails, shortBusinessName } from '../src/contacts.js';

test('France and Belgium are their own markets', () => {
    for (const [name, code, dir] of [['France', 'FR', 'output-fr'], ['FR', 'FR', 'output-fr'], ['Belgium', 'BE', 'output-be'], ['Belgique', 'BE', 'output-be']]) {
        const c = resolveCountry({ country: name });
        assert.equal(c.code, code);
        assert.equal(c.outputDir, dir);
    }
    const fr = resolveCountry({ country: 'FR' });
    const be = resolveCountry({ country: 'BE' });
    const frLocs = resolveLocations({ country: 'FR' }, () => {});
    assert.ok(frLocs.some(l => l.city === 'Le Marais, Paris'));
    assert.ok(frLocs.some(l => l.city === 'Sarcelles'));
    assert.ok(frLocs.some(l => l.city === 'Strasbourg'));
    const beLocs = resolveLocations({ country: 'BE' }, () => {});
    assert.ok(beLocs.some(l => l.city === 'Diamantwijk, Antwerpen'));
    assert.ok(beLocs.some(l => l.city === 'Uccle, Bruxelles'));
    assert.equal(buildQueryMatrix(frLocs, fr.categories, fr.highYield)[0].text, 'Judaica Paris');
    assert.equal(mapsSearchUrl('Judaica Antwerpen', be.gl), 'https://www.google.com/maps/search/Judaica%20Antwerpen?hl=en&gl=be');
    assert.equal(fr.phoneCode, '33');
    assert.equal(be.phoneCode, '32');
});

test('cross-border results and cities', () => {
    const fr = resolveCountry({ country: 'FR' });
    const be = resolveCountry({ country: 'BE' });
    assert.ok(fr.foreign.test('Rue Neuve 1, 1000 Bruxelles, Belgium'));
    assert.ok(fr.foreign.test('Bd des Moulins, 98000 Monaco'));
    assert.ok(!fr.foreign.test('10 Rue des Rosiers, 75004 Paris'));
    assert.ok(be.foreign.test('Rue X, 59000 Lille, France'));
    assert.ok(!be.foreign.test('Lange Kievitstraat 1, 2018 Antwerpen'));
    assert.equal(pickCity('10 Rue des Rosiers, 75004 Paris', 'Le Marais, Paris', fr), 'Paris');
    assert.equal(pickCity('3 Av. Paul Valéry, 95200 Sarcelles', 'Paris', fr), 'Sarcelles');
    assert.equal(pickCity('Lange Kievitstraat 1, 2018 Antwerpen', 'Diamantwijk, Antwerpen', be), 'Antwerpen');
    assert.equal(pickCity('Rue Vanderkindere 1, 1180 Uccle', 'Uccle, Bruxelles', be), 'Bruxelles');
});

test('French and Dutch Judaica words', () => {
    assert.equal(scoreRelevance({ business_name: 'Judaïca Rosiers', category: 'Gift shop' }).tier, 'Judaica seller');
    assert.equal(scoreRelevance({ business_name: 'Librairie du Temple', category: 'Book store' }, 'mezouza, hanoukia, chandeliers de chabbat').tier, 'Judaica seller');
    assert.equal(scoreRelevance({ business_name: 'Joodse Boekhandel', category: 'Book store' }, 'mezoeza chanoekia').tier, 'Judaica seller');
    assert.equal(scoreRelevance({ business_name: 'Épicerie casher du Marais', category: 'Kosher grocery store' }).tier, 'Jewish / Israeli retail');
    assert.equal(scoreRelevance({ business_name: 'Koosjer Winkel', category: 'Grocery store' }).tier, 'Jewish / Israeli retail');
    assert.ok(!isTarget(scoreRelevance({ business_name: 'Chez Marianne', category: 'Restaurant' }, 'casher juif')));
    assert.ok(!isTarget(scoreRelevance({ business_name: 'Ménorah Coiffure', category: 'Hair salon' })));
});

test('French and Belgian organisations are not buyers', () => {
    for (const [business_name, category] of [
        ['Synagogue de la Victoire', 'Synagogue'],
        ['Consistoire de Paris', 'Religious organization'],
        ['Musée d\'art et d\'histoire du Judaïsme', 'Museum'],
        ['École Lucien de Hirsch', 'School'],
        ['Joods Museum van Deportatie ASBL', 'Museum'],
        ['Shomre Hadass VZW', 'Gift shop'],
        ['Centre communautaire juif', ''],
        ['Beth Habad Neuilly', ''],
    ]) assert.equal(isSellable({ business_name, category }).ok, false, business_name);
    for (const [business_name, category, website] of [
        ['Boutique du Musée juif SARL', 'Gift shop', ''],
        ['Librairie Gibert Joseph', 'Book store', ''],
        ['Judaica Antwerp BVBA', 'Store', 'https://www.judaica-antwerp.be/'],
    ]) assert.equal(isSellable({ business_name, category, website }).ok, true, business_name);
    assert.equal(isSellable({ business_name: 'Galerie municipale', category: 'Art gallery', website: 'https://www.mairie-sarcelles.fr/galerie', city: 'Sarcelles' }).ok, false);
    assert.equal(isSellable({ business_name: 'Kunstencentrum', category: 'Art gallery', website: 'https://www.antwerpen.be/kunst', city: 'Antwerpen' }).ok, false);
});

test('legal notices: the person, the role, the greeting', () => {
    const cases = [
        ['Directeur de la publication : Mme Sarah Cohen, Société Judaïca SARL', 'Mme Sarah Cohen', 'Dear Ms. Cohen'],
        ['Gérant : David Lévy SIRET 123 456', 'David Lévy', 'Dear David Lévy'],
        ['Directrice de la publication: Rachel Benhamou Hébergeur OVH', 'Rachel Benhamou', 'Dear Ms. Benhamou'],
        ['Responsable de la publication : Monsieur Élie Attal', 'Monsieur Élie Attal', 'Dear Mr. Attal'],
        ['Zaakvoerder: Jan Peeters Lange Kievitstraat 12', 'Jan Peeters', 'Dear Jan Peeters'],
        ['Zaakvoerster: Esther Goldberg BTW BE0123', 'Esther Goldberg', 'Dear Ms. Goldberg'],
        ['Eigenaar: Mevrouw Sarah De Smet', 'Mevrouw Sarah De Smet', 'Dear Ms. De Smet'],
    ];
    for (const [text, name, greeting] of cases) {
        const c = extractContact(text);
        assert.equal(c.name, name, text);
        assert.equal(greetingFor({ contact_name: c.name, contact_role: c.role }), greeting, text);
    }
    assert.equal(shortBusinessName('Judaïca Rosiers SARL'), 'Judaïca Rosiers');
    assert.equal(shortBusinessName('Judaica Antwerp BVBA'), 'Judaica Antwerp');
});

test('French and Belgian inboxes rank as expected', () => {
    assert.equal(rankEmails(['webmaster@agence-web.fr', 'x@orange.fr', 'contact@judaica-rosiers.fr'], 'https://www.judaica-rosiers.fr/', 'Judaïca Rosiers')[0], 'contact@judaica-rosiers.fr');
    assert.equal(rankEmails(['rgpd@shop.be', 'winkel@shop.be'], 'https://www.shop.be/', 'Shop')[0], 'winkel@shop.be');
    assert.equal(rankEmails(['dpo@x.fr', 'owner@skynet.be'], '', 'X')[0], 'owner@skynet.be');
});
