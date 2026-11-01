terraform {
  required_version = ">= 1.13.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

resource "random_bytes" "tunnel_secret" {
  length = 32
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "this" {
  account_id    = var.account_id
  name          = "nekolog-${var.environment}"
  config_src    = "local"
  tunnel_secret = random_bytes.tunnel_secret.base64

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "hostname" {
  zone_id = var.zone_id
  name    = "${var.hostname}.${var.zone_name}"
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.this.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
  comment = "Managed by OpenTofu: ${var.environment} tunnel"
}
