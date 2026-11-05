terraform {
  required_version = ">= 1.13.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

module "dns" {
  source = "../modules/vps-dns"

  zone_id   = var.cloudflare_zone_id
  zone_name = var.zone_name
  ipv4      = var.vps_ipv4
  hostnames = var.hostnames
}

module "backups" {
  source = "../modules/backup-bucket"

  account_id = var.cloudflare_account_id
  name       = var.backup_bucket
  keep_days  = var.backup_keep_days
  location   = var.backup_location
}
