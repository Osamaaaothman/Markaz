-- A role that grants only the AI assistant, so it can be given to anyone later. Created in every company
-- that does not have it yet and assigned to that company's current Admin users. The Admin role keeps its
-- own AI grants; this role is for everyone else. AI settings stay with Admin (ai_settings:manage).

INSERT INTO "document_number_series" ("id", "company_id", "document_type", "fiscal_year", "prefix", "padding", "last_number", "updated_at")
SELECT gen_random_uuid()::text, c."id", 'REF_ROL', 'ALL', 'ROL-', 6, 0, now()
FROM "companies" c
ON CONFLICT ("company_id", "document_type", "fiscal_year") DO NOTHING;

-- Never hand out a number a company already uses (refs written before the series existed).
UPDATE "document_number_series" s
SET "last_number" = GREATEST(s."last_number", COALESCE((
  SELECT max(substring(r."ref" FROM '^ROL-(\d+)$')::int) FROM "roles" r WHERE r."company_id" = s."company_id"
), 0))
WHERE s."document_type" = 'REF_ROL' AND s."fiscal_year" = 'ALL';

WITH needing AS (
  SELECT c."id" AS company_id
  FROM "companies" c
  WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."company_id" = c."id" AND r."name" = 'AI assistant')
), bumped AS (
  UPDATE "document_number_series" s
  SET "last_number" = s."last_number" + 1, "updated_at" = now()
  FROM needing n
  WHERE s."company_id" = n.company_id AND s."document_type" = 'REF_ROL' AND s."fiscal_year" = 'ALL'
  RETURNING s."company_id", s."prefix", s."padding", s."last_number"
)
INSERT INTO "roles" ("id", "company_id", "ref", "name", "created_at", "updated_at", "version")
SELECT gen_random_uuid()::text, b."company_id", b."prefix" || lpad(b."last_number"::text, b."padding", '0'), 'AI assistant', now(), now(), 1
FROM bumped b;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" = 'AI assistant'
  AND p."code" IN ('ai_assistant:use', 'ai_assistant:interact', 'ai_assistant:auto')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "user_roles" ("user_id", "role_id")
SELECT ur."user_id", ai."id"
FROM "user_roles" ur
JOIN "roles" admin ON admin."id" = ur."role_id" AND admin."name" = 'Admin'
JOIN "roles" ai ON ai."company_id" = admin."company_id" AND ai."name" = 'AI assistant'
ON CONFLICT ("user_id", "role_id") DO NOTHING;
