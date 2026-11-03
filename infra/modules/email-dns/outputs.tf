output "send_domain" {
  description = "Subdomain every message is sent from."
  value       = local.send_domain
}

output "dmarc" {
  description = "The DMARC record this module publishes."
  value       = local.dmarc
}
