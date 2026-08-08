-- Link reversal journals to the original entry reference (mirrors Firestore reversesReference).
ALTER TABLE transactions ADD COLUMN reverses_reference TEXT;
ALTER TABLE transactions ADD COLUMN undoes_reversal_reference TEXT;
CREATE INDEX IF NOT EXISTS idx_transactions_reverses_ref ON transactions(reverses_reference, is_deleted);
