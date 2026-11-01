terraform {
  required_version = ">= 1.13.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
}

resource "cloudflare_zero_trust_access_service_token" "workers" {
  account_id = var.account_id
  name       = "nekolog-workers-${var.environment}"
  duration   = var.token_duration
}

resource "cloudflare_zero_trust_access_policy" "workers" {
  account_id = var.account_id
  name       = "nekolog-workers-${var.environment}"
  decision   = "non_identity"

  include = [
    {
      service_token = {
        token_id = cloudflare_zero_trust_access_service_token.workers.id
      }
    }
  ]

  lifecycle {
    postcondition {
      condition = [
        for rule in self.include : try(rule.service_token.token_id, null)
      ] == [cloudflare_zero_trust_access_service_token.workers.id]

      error_message = "This policy has to include exactly the Workers service token and nothing else."
    }
  }
}

resource "cloudflare_zero_trust_access_policy" "operators" {
  account_id = var.account_id
  name       = "nekolog-operators-${var.environment}"
  decision   = "allow"

  session_duration = var.operator_session_duration

  include = [
    for address in var.operator_emails : {
      email = {
        email = address
      }
    }
  ]

  lifecycle {
    postcondition {
      condition = toset([
        for rule in self.include : try(rule.email.email, null)
      ]) == toset(var.operator_emails)

      error_message = "This policy has to include exactly the operator addresses and nothing else."
    }
  }
}

resource "cloudflare_zero_trust_access_application" "clickhouse" {
  account_id       = var.account_id
  name             = "nekolog-clickhouse-${var.environment}"
  type             = "self_hosted"
  session_duration = var.operator_session_duration

  app_launcher_visible       = false
  http_only_cookie_attribute = true
  enable_binding_cookie      = true
  same_site_cookie_attribute = "strict"
  service_auth_401_redirect  = true
  auto_redirect_to_identity  = false

  destinations = [
    {
      type = "public"
      uri  = var.hostname
    }
  ]

  policies = [
    {
      id         = cloudflare_zero_trust_access_policy.workers.id
      precedence = 1
    },
    {
      id         = cloudflare_zero_trust_access_policy.operators.id
      precedence = 2
    }
  ]
}
