-- Removing a purchase-order approval threshold means deleting the policy row: no row = never
-- needs approval (approval-policy.ts). Policies are configuration, not accounting records, so
-- unlike the ledger tables DELETE is appropriate here; requests already made are untouched.
GRANT DELETE ON "approval_policies" TO erp_app;
