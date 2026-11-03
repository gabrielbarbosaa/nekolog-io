terraform {
  required_version = ">= 1.13.0"

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 3.0"
    }
  }
}

locals {
  outside_zone = [
    for hostname in keys(var.domains) :
    hostname if hostname != var.zone_name && !endswith(hostname, ".${var.zone_name}")
  ]

  targetless = [
    for name, variable in var.variables :
    name if length(variable.target) == 0
  ]

  unknown_target = [
    for name, variable in var.variables :
    name if length(setsubtract(variable.target, ["production", "preview", "development"])) > 0
  ]

  production_from_preview = [
    for name, variable in var.variables :
    name if contains(variable.target, "production") && variable.git_branch != null
  ]

  shared_between_environments = [
    for name, variable in var.variables :
    name if coalesce(variable.sensitive, true) && contains(variable.target, "preview") && variable.git_branch == null
  ]
}

resource "vercel_project" "this" {
  name            = var.name
  framework       = var.framework
  root_directory  = var.root_directory
  build_command   = var.build_command
  install_command = var.install_command
  ignore_command  = var.ignore_command

  git_repository = {
    type              = "github"
    repo              = var.repo
    production_branch = var.production_branch
  }

  lifecycle {
    precondition {
      condition     = length(local.outside_zone) == 0
      error_message = "Every domain has to be inside ${var.zone_name}: ${join(", ", local.outside_zone)}"
    }

    precondition {
      condition     = length(local.targetless) == 0
      error_message = "A variable with no target reaches no deployment: ${join(", ", local.targetless)}"
    }

    precondition {
      condition     = length(local.unknown_target) == 0
      error_message = "A target has to be production, preview or development: ${join(", ", local.unknown_target)}"
    }

    precondition {
      condition     = length(local.production_from_preview) == 0
      error_message = "A production variable cannot be scoped to a branch, or production would read a branch's value: ${join(", ", local.production_from_preview)}"
    }

    precondition {
      condition     = length(local.shared_between_environments) == 0
      error_message = "A secret for preview has to name its branch, or dev and qa share the same value: ${join(", ", local.shared_between_environments)}"
    }
  }
}

resource "vercel_project_domain" "this" {
  for_each = var.domains

  project_id = vercel_project.this.id
  domain     = each.key
  git_branch = each.value.git_branch
}

resource "vercel_project_environment_variable" "this" {
  for_each = var.variables

  project_id = vercel_project.this.id
  key        = each.key
  value      = each.value.value
  target     = each.value.target
  git_branch = each.value.git_branch
  sensitive  = each.value.sensitive
}
