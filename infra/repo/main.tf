terraform {
  required_version = ">= 1.13.0"

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
  }
}

provider "github" {
  owner = var.owner
  token = var.github_token
}

locals {
  required_checks = [
    "Lint, typecheck, test, build",
    "Analyze (javascript-typescript)",
    "dependency-review",
    "Validate PR source branch",
  ]

  branches = {
    dev  = { require_signatures = false }
    qa   = { require_signatures = true }
    main = { require_signatures = true }
  }
}

import {
  for_each = var.adopt_ruleset_ids

  to = github_repository_ruleset.branch[each.key]
  id = "${var.repository}:${each.value}"
}

resource "github_repository_ruleset" "branch" {
  for_each = local.branches

  name        = each.key
  repository  = var.repository
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["refs/heads/${each.key}"]
      exclude = []
    }
  }

  rules {
    deletion         = true
    non_fast_forward = true
    update           = false

    required_signatures = each.value.require_signatures

    pull_request {
      required_approving_review_count   = 0
      dismiss_stale_reviews_on_push     = false
      require_code_owner_review         = false
      require_last_push_approval        = false
      required_review_thread_resolution = false
    }

    required_status_checks {
      strict_required_status_checks_policy = false

      dynamic "required_check" {
        for_each = local.required_checks

        content {
          context = required_check.value
        }
      }
    }
  }
}
