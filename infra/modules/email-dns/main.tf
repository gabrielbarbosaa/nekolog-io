terraform {
  required_version = ">= 1.13.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
}

locals {
  send_domain = "${var.send_subdomain}.${var.zone_name}"

  dmarc = join("; ", [
    "v=DMARC1",
    "p=${var.dmarc_policy}",
    "rua=mailto:${var.dmarc_reports_to}",
    "ruf=mailto:${var.dmarc_reports_to}",
    "fo=1",
    "adkim=s",
    "aspf=s",
  ])
}

resource "cloudflare_dns_record" "mail_from" {
  zone_id  = var.zone_id
  name     = local.send_domain
  type     = "MX"
  content  = var.mail_from_host
  priority = 10
  proxied  = false
  ttl      = 1
  comment  = "Managed by OpenTofu: bounce path of the sending subdomain"
}

resource "cloudflare_dns_record" "spf" {
  zone_id = var.zone_id
  name    = local.send_domain
  type    = "TXT"
  content = "\"v=spf1 include:${var.spf_include} ~all\""
  proxied = false
  ttl     = 1
  comment = "Managed by OpenTofu: who may send as the sending subdomain"
}

resource "cloudflare_dns_record" "dkim" {
  for_each = var.dkim_records

  zone_id = var.zone_id
  name    = "${each.key}._domainkey.${local.send_domain}"
  type    = "TXT"
  content = "\"${each.value}\""
  proxied = false
  ttl     = 1
  comment = "Managed by OpenTofu: DKIM public key ${each.key}"
}

resource "cloudflare_dns_record" "dmarc" {
  zone_id = var.zone_id
  name    = "_dmarc.${var.zone_name}"
  type    = "TXT"
  content = "\"${local.dmarc}\""
  proxied = false
  ttl     = 1
  comment = "Managed by OpenTofu: what a receiver does with a message that fails"

  lifecycle {
    precondition {
      condition     = endswith(var.dmarc_reports_to, "@${var.zone_name}")
      error_message = "The reports have to go to an address inside the zone, or the receiver needs an authorisation record this module does not create."
    }
  }
}

resource "cloudflare_email_routing_settings" "this" {
  count = length(var.forwarded_addresses) > 0 ? 1 : 0

  zone_id = var.zone_id
}

resource "cloudflare_email_routing_address" "destination" {
  count = var.forward_to == null ? 0 : 1

  account_id = var.account_id
  email      = var.forward_to
}

resource "cloudflare_email_routing_rule" "forward" {
  for_each = toset(var.forwarded_addresses)

  zone_id = var.zone_id
  name    = "forward ${each.value}"
  enabled = true

  matchers = [{
    type  = "literal"
    field = "to"
    value = "${each.value}@${var.zone_name}"
  }]

  actions = [{
    type  = "forward"
    value = [var.forward_to]
  }]

  lifecycle {
    precondition {
      condition     = var.forward_to != null
      error_message = "Forwarding an address needs a mailbox to forward it to."
    }
  }

  depends_on = [cloudflare_email_routing_address.destination]
}
