output "send_domain" {
  description = "Subdomain every message is sent from."
  value       = module.email.send_domain
}

output "dmarc" {
  description = "The DMARC record published for the zone."
  value       = module.email.dmarc
}
