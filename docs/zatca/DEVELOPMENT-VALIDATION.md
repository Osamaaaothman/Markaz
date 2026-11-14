# ZATCA development validation and renewal

Verified against official Java SDK **238-R3.4.8**, 2026-11-15. These are offline
development checks, not a certificate of compliance or evidence of government acceptance.

## Required CI gate

Every PR and main build in `.github/workflows/ci.yml` downloads the public SDK from
the link published at [ZATCA's SDK page](https://sandbox.zatca.gov.sa/downloadSDK).
It verifies SHA-256
`91d079b4a6c21c8ed7fb6ec434227409537119cae8b74de34dc150f91793d1f6`, configures absolute
resource paths, and uses Temurin **Java 11**. Vendor binaries and sample keys remain
outside Git and customer deployments. An unavailable download, changed checksum,
missing SDK, missing database, unknown verdict or failed validation fails CI.

`ZATCA_REQUIRE_SDK=1` is forwarded through Turbo to both compliance and API tests.
Developers can run unrelated unit tests without the SDK, with explicitly skipped
SDK suites; that mode is not a release check. This makes SDK validation mandatory
within CI. GitHub reported main unprotected when checked; requiring a green CI job
before merge is a separate repository setting, unchanged by this PR.

For a local extracted SDK and an **isolated, migrated test database**:

```sh
export ZATCA_SDK_DIR=/absolute/path/to/zatca-einvoicing-sdk-Java-238-R3.4.8
export ZATCA_REQUIRE_SDK=1
export DATABASE_URL=postgresql://test-user:test-password@localhost/test-db
# Put Java 11 and Node 22 on PATH first.
node scripts/prepare-zatca-sdk.mjs
npm run build
npm run test --workspace=@erp/compliance-zatca-sa -- --runInBand
npm run test --workspace=@erp/api -- --runInBand zatca-sales-flow.integration.spec.ts compliance-admin.integration.spec.ts
```

The sales integration test posts real invoices, credit notes and debit notes through
`SalesInvoiceService`, reads the committed outbox through `ZatcaInvoiceMapper`, and
submits through `InvoiceSubmissionService` with a synthetic HTTP authority. The
persisted signed XML for all **six** combinations (standard/simplified × invoice,
credit, debit) is independently validated by the official SDK. It also verifies
ICV/PIH continuity, immutable XML, QR source, statuses and printable documents.
Only the SDK's public sample key/certificate are used in that isolated test company.
No test contacts the ZATCA invoice or renewal endpoints.

Each SDK invocation receives its own PIH file/config, using the expected database
chain context. Shared SDK resources are never changed by a running test. Java uses
UTF-8 explicitly; Java 11's default Windows code page corrupts Arabic input.

## Signature findings corrected by the expanded gate

The previous local verifier and signer agreed with each other but differed from
SDK 3.4.8. The SDK's `SignatureValidator`, `ECDSAUtil`, and `Utils.getNodeXmlValue`
establish the profile used here:

- ECDSA with SHA-256 operates on the raw invoice digest bytes.
- The certificate digest hashes the UTF-8 base64 certificate text, then encodes the
  hexadecimal digest as base64.
- The SignedProperties digest uses the SDK's serialized XML form, preserving
  whitespace/empty elements with namespace declarations before other attributes.

The local verifier now accepts the official signed samples with **no waived
signature, certificate-digest or SignedProperties errors**. Earlier notes attributing
those mismatches to inconsistent sample data were incorrect and are superseded by
these independently verified results. Tampered signatures/documents remain rejected.
This does not repair an EGS whose stored certificate belongs to a different key.
Previously persisted signed XML is not rewritten on retry; older failed documents
must be reviewed rather than silently re-signed under the same chain position.

## Renewal contract and behavior

ZATCA support confirms `PATCH /production/csids`, Basic authentication using the
**current issuance CSID and secret**, a fresh **renewal OTP** from the same portal
environment, and a body containing the base64 CSR:
[current endpoints/authentication](https://zatca1.discourse.group/t/change-to-the-new-api-url/5456).
The EGS reuses its existing private key when constructing that CSR.

A `428 NOT_COMPLIANT` response can supply a new compliance CSID, secret and request
ID. It requires compliance checks and a subsequent `POST /production/csids`:
[ZATCA renewal guidance](https://zatca1.discourse.group/t/how-to-renew-expired-pcsid/524).

- A valid direct issuance response replaces only the issuance credentials and expiry.
- A valid 428 stages the new compliance credentials, preserves the old issuance
  credentials, and moves the unit/credential to `COMPLIANCE_CSID_ISSUED` atomically.
  The UI explains the two remaining steps; new submissions pause while inactive.
- The existing checks screen runs every required sample. Only after they all pass
  can issuance resume. `lastRenewalAt` records completed renewal, not the pending step.
- Malformed, expired, not-yet-valid or key-mismatched certificates cannot replace the
  stored credentials. A concurrent credential change prevents stale renewal results
  from overwriting it. OTP/authentication/transport failures preserve the prior state.
- The private key and ICV/PIH chain are never reset. Raw onboarding response bodies
  are never returned to the browser or audit log because even an error can contain secrets.

Integration tests cover these transitions, failures, tenant isolation and secret
redaction against PostgreSQL with scripted HTTP responses.

## Still required before real use

An authorized FATOORA Simulation account and portal OTP are needed to demonstrate
onboarding, all six compliance checks, real clearance/reporting and renewal against
the live Simulation environment using a certificate bound to the EGS key. That live
exercise has **not** been performed. Sandbox static responses and a readable QR do
not replace it. Production onboarding and production acceptance remain separate
steps using the company's actual data and credentials. Keep the development notices.
