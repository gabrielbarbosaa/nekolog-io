output "names" {
  description = "Every name published, in full."
  value       = sort([for record in cloudflare_dns_record.host : record.name])
}

output "proxied" {
  description = "The names Cloudflare stands in front of."
  value       = sort([for record in cloudflare_dns_record.host : record.name if record.proxied])
}
