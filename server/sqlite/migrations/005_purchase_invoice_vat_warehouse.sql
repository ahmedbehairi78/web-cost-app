-- VAT % for inventory unit cost (purchase + VAT) on distributed purchase invoices
ALTER TABLE purchase_invoices ADD COLUMN vat_pct REAL NOT NULL DEFAULT 0;
