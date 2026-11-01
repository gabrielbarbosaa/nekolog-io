output "namespace_id" {
  description = "Binding value for the KEYS namespace in wrangler."
  value       = cloudflare_workers_kv_namespace.keys.id
}

output "title" {
  description = "Name the namespace carries in the Cloudflare dashboard."
  value       = cloudflare_workers_kv_namespace.keys.title
}
