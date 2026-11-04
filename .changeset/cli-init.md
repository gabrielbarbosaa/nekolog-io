---
'@nekolog-io/cli': minor
---

Add `npx @nekolog-io/cli init`: read the project's `package.json`, pick the right SDK, install it with whichever package manager the lockfile names, and write the environment variables. The detection order matters because real projects have several of these at once — `next` beats `react` and `@nestjs/core` beats `express`, since in both cases the outer one is in charge — and it always says why it chose. Four things it refuses to do: overwrite a variable the `.env` already has (your real key is never replaced by a placeholder, or by the one just passed to `--key`), put a secret key in a `NEXT_PUBLIC_` variable that ships in the bundle, write anything at all when the key does not look like a key (the check runs before the first write, so a bad `--key` leaves no half file), and run the package manager through a shell — the arguments go as a list, with a test that pushes an `&` through and reads it back whole.
