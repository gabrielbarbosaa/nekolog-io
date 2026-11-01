output "tunnel_id" {
  description = "UUID cloudflared needs in its credentials file."
  value       = cloudflare_zero_trust_tunnel_cloudflared.this.id
}

output "account_tag" {
  description = "Account tag cloudflared needs in its credentials file."
  value       = cloudflare_zero_trust_tunnel_cloudflared.this.account_tag
}

output "tunnel_secret" {
  description = "Secret cloudflared needs in its credentials file."
  value       = random_bytes.tunnel_secret.base64
  sensitive   = true
}

output "fqdn" {
  description = "Hostname the tunnel answers on."
  value       = "${var.hostname}.${var.zone_name}"
}
