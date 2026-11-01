terraform {
  required_version = ">= 1.13.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
}

resource "cloudflare_workers_custom_domain" "this" {
  account_id = var.account_id
  zone_id    = var.zone_id
  zone_name  = var.zone_name
  hostname   = var.hostname
  service    = var.service

  lifecycle {
    precondition {
      condition     = endswith(var.hostname, ".${var.zone_name}")
      error_message = "The hostname has to be inside the zone this module manages."
    }
  }
}
