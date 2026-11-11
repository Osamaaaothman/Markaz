# Customer and supplier party selection

Customer/supplier pickers exclude parties with `kind: EMPLOYEE`. This covers sales
quotations, orders and invoices; purchase orders and supplier invoices; goods
receipts; customer receipts, supplier payments, settlement and customer/supplier
statements. `COMPANY`, `PERSON` and `OTHER` remain eligible in both roles.

The Parties directory and chart-of-accounts party links still include employees.
Their HR links, salary, advance and end-of-service accounts are unchanged. No data
migration is required and existing documents are not rewritten.

`GET /v1/parties` accepts an optional `excludeEmployees=true|false` query parameter
(permission: `party:read`). Omission/`false` preserves the previous behavior. The
company scope, active status, search and kind filters still apply; exclusion is
applied before cursor pagination. Combining `kind=EMPLOYEE` with exclusion returns
an empty result. Invalid flag values return validation errors.

`PartyPicker` opts into this query with `excludeEmployees`. The query cache includes
the flag, and the picker also filters any supplied current party. General accounting
pickers leave the flag unset. This is selection filtering, not a new document-write
validation rule; historical documents and restored drafts retain their stored IDs.

Regression coverage uses PostgreSQL with 55 employees preceding commercial parties,
pagination, Arabic/English searches, inactive records and company scoping. Frontend
tests cover current-party merging, employee exclusion and general account selection;
API DTO tests reject malformed flags.
