# Party classifications

`CUSTOMER_SUPPLIER` identifies one party that participates in both sales and
purchasing. It is returned by `GET /v1/parties?kind=CUSTOMER` and `kind=SUPPLIER`;
the exact `kind=CUSTOMER_SUPPLIER` filter returns only dual-role parties. Filtering
and active-state checks run in the database before cursor pagination and remain
company-scoped. The directory shows dual-role parties in both tabs with a badge.

Reclassification updates the existing party and audit history. It does not clone
the party, rewrite historical documents or provision accounts retroactively.
Classifying a party as `EMPLOYEE` does not create an HR employee profile.

New commercial parties, including imports, provision an account for each role
whose parent folder is configured. Customer and supplier accounts remain separate;
no balances are netted. Creation returns `accountCodes` and preserves the original
`accountCode` field for older clients. Missing mappings remain optional.

Apply the additive party-kind and account-mapping-key migrations before deploying
clients that offer the new kind. Old COMPANY, PERSON, EMPLOYEE and OTHER rows stay
valid. Importing employees remains an HR workflow.

Regression coverage: `party.service.integration.spec.ts` and
`../master-data/import.integration.spec.ts`, against migrated PostgreSQL.
