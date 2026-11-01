output "application_id" {
  description = "Id of the Access application in front of SSH."
  value       = cloudflare_zero_trust_access_application.ssh.id
}

output "hostname" {
  description = "Hostname an operator points cloudflared access ssh at."
  value       = var.hostname
}
