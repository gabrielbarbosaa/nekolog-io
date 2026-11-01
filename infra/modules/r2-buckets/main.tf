terraform {
  required_version = ">= 1.13.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
}

resource "cloudflare_r2_bucket" "spool" {
  account_id = var.account_id
  name       = "nekolog-spool-${var.environment}"
  location   = var.location

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "sourcemaps" {
  account_id = var.account_id
  name       = "nekolog-sourcemaps-${var.environment}"
  location   = var.location

  lifecycle {
    prevent_destroy = true
  }
}
