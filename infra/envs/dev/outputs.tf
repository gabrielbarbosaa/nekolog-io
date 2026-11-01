output "kv_namespace_id" {
  description = "Binding value for KEYS in wrangler."
  value       = module.environment.kv_namespace_id
}

output "spool_bucket" {
  description = "Binding value for SPOOL in wrangler."
  value       = module.environment.spool_bucket
}

output "sourcemaps_bucket" {
  description = "Bucket the bundler plugin uploads source maps to."
  value       = module.environment.sourcemaps_bucket
}

output "clickhouse_url" {
  description = "CLICKHOUSE_URL for the Workers."
  value       = module.environment.clickhouse_url
}

output "tunnel_id" {
  description = "UUID cloudflared needs in its credentials file."
  value       = module.environment.tunnel_id
}

output "tunnel_account_tag" {
  description = "Account tag cloudflared needs in its credentials file."
  value       = module.environment.tunnel_account_tag
}

output "tunnel_secret" {
  description = "Secret cloudflared needs in its credentials file."
  value       = module.environment.tunnel_secret
  sensitive   = true
}

output "access_client_id" {
  description = "CF_ACCESS_CLIENT_ID for the Workers."
  value       = module.environment.access_client_id
}

output "access_client_secret" {
  description = "CF_ACCESS_CLIENT_SECRET for the Workers."
  value       = module.environment.access_client_secret
  sensitive   = true
}