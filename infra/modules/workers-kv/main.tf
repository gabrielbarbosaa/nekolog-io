terraform {
  required_version = ">= 1.13.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
}

resource "cloudflare_workers_kv_namespace" "keys" {
  account_id = var.account_id
  title      = "nekolog-keys-${var.environment}"

  lifecycle {
    prevent_destroy = true
  }
}
