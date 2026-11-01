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

locals {
  ingest_hostname = var.environment == "prod" ? "ingest.${var.zone_name}" : "ingest-${var.environment}.${var.zone_name}"
}

module "kv" {
  source = "../workers-kv"

  account_id  = var.account_id
  environment = var.environment
}

module "r2" {
  source = "../r2-buckets"

  account_id  = var.account_id
  environment = var.environment
  location    = var.r2_location
}

module "tunnel" {
  source = "../tunnel"

  account_id = var.account_id
  zone_id    = var.zone_id
  zone_name  = var.zone_name
  purpose    = var.environment
  hostname   = "clickhouse-${var.environment}"
}

module "ingest_domain" {
  source = "../workers-domain"

  account_id = var.account_id
  zone_id    = var.zone_id
  zone_name  = var.zone_name
  hostname   = local.ingest_hostname
  service    = "nekolog-ingest-${var.environment}"
}

module "access" {
  source = "../access"

  account_id                = var.account_id
  environment               = var.environment
  hostname                  = module.tunnel.fqdn
  operator_emails           = var.operator_emails
  operator_session_duration = var.operator_session_duration
}
