output "names" {
  description = "Every name published for the machine."
  value       = module.dns.names
}

output "proxied" {
  description = "The names Cloudflare stands in front of."
  value       = module.dns.proxied
}

output "backup_bucket" {
  description = "Bucket the ClickHouse and the Postgres backups write to."
  value       = module.backups.bucket
}

output "backup_expiring_prefix" {
  description = "The one prefix the lifecycle rule expires."
  value       = module.backups.expiring_prefix
}
