---
'@nekolog-io/adapters': minor
---

Implement `Mailer` for the cloud and for self-host: `resendMailer` posts to Resend's API with nothing but `fetch`, and `smtpMailer` takes a nodemailer-shaped transport the caller injects, which is also how the dev stack's Mailpit is reached.

Every message is checked before it leaves, in both implementations and before the network call rather than after. A carriage return or newline in the recipient or the subject forges a header — it is how an unseen `bcc:` gets added — so it is refused; the address is lowercased and has to be a single address, with display names, commas and angle brackets rejected.

`allowlistedMailer` enforces `EMAIL_ALLOWLIST` in dev and qa, and **an empty list allows nobody**. A missing variable is the likeliest state of a fresh machine, and the safe reading there is to write to no strangers at all. Entries match an address exactly or a whole domain through its leading `@`, so neither a `+tag` nor a longer lookalike domain slips through.

The integration tests deliver through a real SMTP server and read the message back from Mailpit's API, including a check that a smuggled second recipient never arrives.
