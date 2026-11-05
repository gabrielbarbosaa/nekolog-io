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
  records = {
    for host, settings in var.hostnames : host => {
      name    = host == "@" ? var.zone_name : "${host}.${var.zone_name}"
      proxied = settings.proxied
    }
  }
}

resource "cloudflare_dns_record" "host" {
  for_each = local.records

  zone_id = var.zone_id
  name    = each.value.name
  type    = "A"
  content = var.ipv4
  proxied = each.value.proxied
  ttl     = 1
  comment = "Managed by OpenTofu: the machine that runs NekoLog"

  lifecycle {
    precondition {
      condition     = var.ipv4 != "0.0.0.0"
      error_message = "0.0.0.0 is not a machine. Set the address of the VPS before applying."
    }
  }
}
