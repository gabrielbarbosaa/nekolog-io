terraform {
  required_version = ">= 1.13.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
}

resource "cloudflare_r2_bucket" "backups" {
  account_id = var.account_id
  name       = var.name
  location   = var.location

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket_lifecycle" "backups" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.backups.name

  rules = [
    {
      id      = "clickhouse-expire-after-${var.keep_days}-days"
      enabled = true

      conditions = {
        prefix = var.clickhouse_prefix
      }

      delete_objects_transition = {
        condition = {
          type    = "Age"
          max_age = var.keep_days * 24 * 60 * 60
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
