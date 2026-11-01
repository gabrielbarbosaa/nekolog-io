terraform {
  required_version = ">= 1.13.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

module "environment" {
  source = "../../modules/environment"

  environment               = "dev"
  account_id                = var.cloudflare_account_id
  zone_id                   = var.cloudflare_zone_id
  zone_name                 = var.zone_name
  operator_emails           = var.operator_emails
  operator_session_duration = var.operator_session_duration
  r2_location               = var.r2_location
}