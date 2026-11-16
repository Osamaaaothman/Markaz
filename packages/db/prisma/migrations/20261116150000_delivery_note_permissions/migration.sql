-- Upgrade existing installations as well as fresh seeds. The original delivery-note
-- migration created its tables, but the permission catalog existed only in seed.ts.
INSERT INTO "permissions" ("id", "code", "description")
VALUES
  (gen_random_uuid()::text, 'sales_delivery_note:create', 'Record a goods delivery note against a sales order'),
  (gen_random_uuid()::text, 'sales_delivery_note:read', 'View goods delivery notes')
ON CONFLICT ("code") DO NOTHING;

-- Match the standard roles in seed.ts; preserve custom roles and every existing grant.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" IN ('Admin', 'Sales', 'Warehouse')
  AND p."code" IN ('sales_delivery_note:create', 'sales_delivery_note:read')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
