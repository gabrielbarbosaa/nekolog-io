output "bucket" {
  description = "Name of the bucket both backups write to."
  value       = cloudflare_r2_bucket.backups.name
}

output "expiring_prefix" {
  description = "The one prefix the lifecycle rule expires."
  value       = var.clickhouse_prefix
}
