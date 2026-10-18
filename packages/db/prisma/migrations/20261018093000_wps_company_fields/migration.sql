-- Company-level fields the WPS wages-file header group needs (HRSD WPS Wages File Technical
-- Specification): the establishment's bank (SARIE id), its bank account number at that bank, and
-- its Ministry of Human Resources establishment id. Nullable -- the export endpoint checks for
-- them and says exactly what is missing rather than guessing.
ALTER TABLE "companies" ADD COLUMN "wps_bank_sarie_id" TEXT;
ALTER TABLE "companies" ADD COLUMN "wps_bank_account_number" TEXT;
ALTER TABLE "companies" ADD COLUMN "wps_mol_establishment_id" TEXT;
