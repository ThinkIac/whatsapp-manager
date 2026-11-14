// Repair the column left by the old Prisma parser. The current parser already
// ignores model attributes, but loading a schema does not remove old columns.
export function repairCampaignSchema(db) {
  return db.transaction(() => {
    const columns = db.prepare('PRAGMA table_info("CampaignRecipient")').all();
    // Older schema-parser versions materialized model attributes and the
    // relation name as regular columns. campaignId already stores that link.
    const legacyColumns = ['@@index([campaignId,', 'campaign']
      .filter((column) => columns.some((item) => item.name === column));
    if (!legacyColumns.length) return { repaired: false };
    for (const column of legacyColumns) {
      const populated = db.prepare(`SELECT count(*) AS count FROM "CampaignRecipient" WHERE "${column}" IS NOT NULL AND "${column}" != ''`).get().count;
      if (populated) throw new Error(`Legacy column ${column} contains data; manual review required`);
    }
    for (const column of legacyColumns) db.exec(`ALTER TABLE "CampaignRecipient" DROP COLUMN "${column}"`);
    db.exec('CREATE INDEX IF NOT EXISTS "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient" ("campaignId", "status")');
    return { repaired: true };
  }).immediate();
}
