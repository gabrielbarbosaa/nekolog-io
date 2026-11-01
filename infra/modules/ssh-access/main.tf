terraform {
  required_version = ">= 1.13.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
}

resource "cloudflare_zero_trust_access_policy" "operators" {
  account_id = var.account_id
  name       = "nekolog-ssh-operators"
  decision   = "allow"

  session_duration = var.session_duration

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

resource "cloudflare_zero_trust_access_application" "ssh" {
  account_id       = var.account_id
  name             = "nekolog-ssh"
  type             = "self_hosted"
  session_duration = var.session_duration

  app_launcher_visible       = false
  http_only_cookie_attribute = true
  enable_binding_cookie      = true
  same_site_cookie_attribute = "strict"
  auto_redirect_to_identity  = false

  destinations = [
    {
      type = "public"
      uri  = var.hostname
    }
  ]

  policies = [
    {
      id         = cloudflare_zero_trust_access_policy.operators.id
      precedence = 1
    }
  ]

  lifecycle {
    postcondition {
      condition = [
        for policy in self.policies : policy.id
      ] == [cloudflare_zero_trust_access_policy.operators.id]

      error_message = "Only a named operator reaches the machine over SSH. A service token must never be able to."
    }
  }
}
