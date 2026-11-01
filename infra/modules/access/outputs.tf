output "client_id" {
  description = "CF_ACCESS_CLIENT_ID for the ingest and jobs Workers."
  value       = cloudflare_zero_trust_access_service_token.workers.client_id
}

output "client_secret" {
  description = "CF_ACCESS_CLIENT_SECRET for the ingest and jobs Workers."
  value       = cloudflare_zero_trust_access_service_token.workers.client_secret
  sensitive   = true
}

output "audience" {
  description = "Access audience tag of the application."
  value       = cloudflare_zero_trust_access_application.clickhouse.aud
}
