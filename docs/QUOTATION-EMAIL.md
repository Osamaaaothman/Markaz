# Quotation email in production

The API sends the quotation PDF through the selected email transport. An accepted
provider response is reported as accepted for sending, not as confirmed inbox
delivery. Failed or unconfigured transports return an error; no success audit
event is recorded. Notification jobs use the same transport in the worker.

## Railway Hobby with Resend

1. Add a domain you control in Resend and publish its requested DNS records.
   Wait for domain verification. Use a sender address on that verified domain.
2. Create a Resend API key with permission to send and retrieve emails (Full access
   for delivery checks). Enter it directly in Railway variables;
   never commit it, include it in a screenshot, or paste it into a support chat.
3. Set these variables on the **API and worker** services:

   | Variable | Value |
   | --- | --- |
   | `EMAIL_PROVIDER` | `resend` |
   | `RESEND_API_KEY` | The real key with send/retrieve permission |
   | `EMAIL_FROM_ADDRESS` | Your verified sender address |

4. Redeploy API and worker. Open an existing quotation, choose Email, check the
   recipient and preview, then send an explicitly authorized test to an address
   you control. Check the inbox and Resend delivery/bounce events.
5. If sending remains disabled, check that variables belong to the API's active
   Railway environment and deployment. Provider rejection, an unverified sender,
   quota limits and network timeouts are displayed as errors.

Railway restricts SMTP to Pro and above; Resend uses HTTPS and works with Hobby's
outbound networking. SMTP remains available for installations that already use
it. `EMAIL_PROVIDER=smtp` uses the documented `SMTP_*` variables in `.env.example`.
No live email was sent during the automated verification of this change.

References verified on 2026-11-11:
- [Railway outbound networking](https://docs.railway.com/networking/outbound-networking)
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction)

## Limits

The quotation button performs a direct provider request. Attempts are persisted
before sending and an idempotency key prevents a repeated request from initiating
another send. A timeout can occur after provider acceptance; an uncertain result
is recorded as Unknown. Check provider records before intentionally sending again.
Resend delivery status is retrieved using **Check delivery** in the email history;
a sending-only key cannot retrieve status. SMTP and Gmail drafts cannot confirm
delivery here. Delivery webhooks and a background sending outbox are not part of
this release. Credentials alone do not establish inbox delivery.

See [operations upgrade details](OPERATIONS-UPGRADES.md) and the
[Resend retrieve-email API](https://resend.com/docs/api-reference/emails/retrieve-email).
