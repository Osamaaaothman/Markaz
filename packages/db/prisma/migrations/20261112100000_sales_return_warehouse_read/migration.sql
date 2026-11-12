-- Sales staff must be able to select the warehouse receiving returned goods.
-- Preserve all existing grants and apply only to the standard Sales role.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" = 'Sales' AND p."code" = 'warehouse:read'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
