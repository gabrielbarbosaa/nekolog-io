terraform {
  required_version = ">= 1.13.0"

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 3.0"
    }
  }
}

provider "vercel" {
  api_token = var.vercel_api_token
  team      = var.vercel_team_id
}

module "site" {
  source = "../modules/vercel-project"

  name              = "nekolog-site"
  repo              = var.site_repo
  production_branch = "main"
  framework         = "nextjs"
  root_directory    = "apps/web"
  zone_name         = var.zone_name
  variables         = var.site_variables

  domains = {
    (var.zone_name)             = {}
    "www.${var.zone_name}"      = {}
    "site-qa.${var.zone_name}"  = { git_branch = "qa" }
    "site-dev.${var.zone_name}" = { git_branch = "dev" }
  }
}

module "docs" {
  source = "../modules/vercel-project"

  name              = "nekolog-docs"
  repo              = var.site_repo
  production_branch = "main"
  framework         = "astro"
  root_directory    = "apps/docs"
  zone_name         = var.zone_name
  variables         = var.docs_variables

  domains = {
    "docs.${var.zone_name}"     = {}
    "docs-qa.${var.zone_name}"  = { git_branch = "qa" }
    "docs-dev.${var.zone_name}" = { git_branch = "dev" }
  }
}

module "dashboard" {
  source = "../modules/vercel-project"

  name              = "nekolog-dashboard"
  repo              = var.dashboard_repo
  production_branch = "main"
  framework         = "nextjs"
  zone_name         = var.zone_name
  variables         = var.dashboard_variables

  domains = {
    "app.${var.zone_name}" = {}
    "qa.${var.zone_name}"  = { git_branch = "qa" }
    "dev.${var.zone_name}" = { git_branch = "dev" }
  }
}
