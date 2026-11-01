output "spool_bucket" {
  description = "Binding value for the SPOOL bucket in wrangler."
  value       = cloudflare_r2_bucket.spool.name
}

output "sourcemaps_bucket" {
  description = "Bucket the bundler plugin uploads source maps to."
  value       = cloudflare_r2_bucket.sourcemaps.name
}
