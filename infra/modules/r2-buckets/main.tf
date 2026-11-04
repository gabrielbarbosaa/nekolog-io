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

resource "cloudflare_r2_bucket" "exports" {
  account_id = var.account_id
  name       = "nekolog-exports-${var.environment}"
  location   = var.location

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket_lifecycle" "exports" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.exports.name

  rules = [
    {
      id      = "exports-expire-after-${var.export_lifetime_days}-days"
      enabled = true

      conditions = {
        prefix = "exports/"
      }

      delete_objects_transition = {
        condition = {
          type    = "Age"
          max_age = var.export_lifetime_days * 24 * 60 * 60
        }
      }

      abort_multipart_uploads_transition = {
        condition = {
          type    = "Age"
          max_age = 24 * 60 * 60
        }
      }
    }
  ]
}
