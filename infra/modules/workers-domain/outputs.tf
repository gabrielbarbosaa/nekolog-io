output "hostname" {
  description = "Hostname the Worker answers on."
  value       = cloudflare_workers_custom_domain.this.hostname
}

output "domain_id" {
  description = "Id of the custom domain, so it can be adopted instead of recreated."
  value       = cloudflare_workers_custom_domain.this.id
}
