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

module "email" {
  source = "../modules/email-dns"

  account_id          = var.cloudflare_account_id
  zone_id             = var.cloudflare_zone_id
  zone_name           = var.zone_name
  mail_from_host      = var.mail_from_host
  spf_include         = var.spf_include
  dkim_records        = var.dkim_records
  dmarc_policy        = var.dmarc_policy
  dmarc_reports_to    = "dmarc@${var.zone_name}"
  forwarded_addresses = var.forwarded_addresses
  forward_to          = var.forward_to
}
