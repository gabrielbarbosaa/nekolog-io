output "kv_namespace_id" {
  description = "Binding value for KEYS in wrangler."
  value       = module.kv.namespace_id
}

output "spool_bucket" {
  description = "Binding value for SPOOL in wrangler."
  value       = module.r2.spool_bucket
}

output "sourcemaps_bucket" {
  description = "Bucket the bundler plugin uploads source maps to."
  value       = module.r2.sourcemaps_bucket
}

output "clickhouse_url" {
  description = "CLICKHOUSE_URL for the Workers, reached through the tunnel."
  value       = "https://${module.tunnel.fqdn}"
}

output "tunnel_id" {
  description = "UUID cloudflared needs in its credentials file."
  value       = module.tunnel.tunnel_id
}

output "tunnel_account_tag" {
  description = "Account tag cloudflared needs in its credentials file."
  value       = module.tunnel.account_tag
}

output "tunnel_secret" {
  description = "Secret cloudflared needs in its credentials file."
  value       = module.tunnel.tunnel_secret
  sensitive   = true
}

output "access_client_id" {
  description = "CF_ACCESS_CLIENT_ID for the Workers."
  value       = module.access.client_id
}

output "access_client_secret" {
  description = "CF_ACCESS_CLIENT_SECRET for the Workers."
  value       = module.access.client_secret
  sensitive   = true
}
