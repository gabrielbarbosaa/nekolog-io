---
'@internal/security-headers': minor
'@apps/web': minor
'@apps/docs': minor
---

Serve both sites with the security headers of plan §14: CSP with a per-response nonce on the landing page and a per-script hash on the static docs, HSTS with preload, `frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy` and `X-Content-Type-Options`. `script-src` carries neither `'unsafe-inline'` nor `'unsafe-eval'` on either side. The tests start the real production server and fail if any `<script>` in the page lacks the nonce, or if the committed `vercel.json` stops covering an inline script the build produced — a script the policy would block is a blank page, not a warning.
