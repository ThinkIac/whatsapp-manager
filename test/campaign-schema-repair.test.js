import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { repairCampaignSchema } from '../core/repairCampaignSchema.js';

test('repairs legacy campaign index column, preserves recipients and allows new inserts', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE CampaignRecipient (id TEXT, campaignId TEXT, status TEXT, "@@index([campaignId," TEXT NOT NULL);
      INSERT INTO CampaignRecipient VALUES ('existing', 'campaign', 'pending', '')`);
    assert.throws(() => db.exec("INSERT INTO CampaignRecipient (id, campaignId, status) VALUES ('new', 'campaign', 'pending')"), /NOT NULL/);
    assert.deepEqual(repairCampaignSchema(db), { repaired: true });
    db.exec("INSERT INTO CampaignRecipient (id, campaignId, status) VALUES ('new', 'campaign', 'pending')");
    assert.equal(db.prepare('SELECT count(*) AS n FROM CampaignRecipient').get().n, 2);
    assert.equal(db.prepare("SELECT status FROM CampaignRecipient WHERE id = 'existing'").get().status, 'pending');
    assert.deepEqual(repairCampaignSchema(db), { repaired: false });
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});

test('refuses to remove unexpected legacy data', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE CampaignRecipient (campaignId TEXT, status TEXT, "@@index([campaignId," TEXT NOT NULL);
      INSERT INTO CampaignRecipient VALUES ('campaign', 'pending', 'keep')`);
    assert.throws(() => repairCampaignSchema(db), /manual review/);
    assert.equal(db.prepare('SELECT "@@index([campaignId," AS value FROM CampaignRecipient').get().value, 'keep');
  } finally { db.close(); }
});

test('repairs an empty legacy relation column', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE CampaignRecipient (id TEXT, campaignId TEXT, status TEXT, campaign TEXT NOT NULL);
      INSERT INTO CampaignRecipient VALUES ('existing', 'campaign', 'pending', '')`);
    assert.deepEqual(repairCampaignSchema(db), { repaired: true });
    db.prepare('INSERT INTO CampaignRecipient (id, campaignId, status) VALUES (?, ?, ?)').run('new', 'campaign', 'pending');
    assert.equal(db.prepare('SELECT count(*) AS n FROM CampaignRecipient').get().n, 2);
  } finally { db.close(); }
});
