---
'@nekolog-io/adapters': minor
'@nekolog-io/db': minor
---

Refuse to write to an address that already bounced, and check a bounce webhook before believing it. `suppressedMailer` asks a suppression list before every send and fails closed when it cannot tell — insisting on an address that hard bounced is the fastest way to lose the whole domain's reputation. `verifyWebhook` checks the provider's HMAC signature in constant time and refuses a missing header, a timestamp outside a five-minute tolerance, a timestamp from the future, and a signature that is only a prefix of the right one; without it, anyone who found the URL could suppress someone else's address and cut off their login. `email_suppressions` holds the list, lowercased and unique per address.
