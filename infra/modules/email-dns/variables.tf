variable "zone_id" {
  description = "Zone of nekolog.io."
  type        = string
}

variable "zone_name" {
  description = "Apex of that zone."
  type        = string
}

variable "send_subdomain" {
  description = "Subdomain every message is sent from, so a bounce never costs the apex its reputation."
  type        = string
  default     = "mail"
}

variable "mail_from_host" {
  description = "Host the provider gives for the bounce path, for example feedback-smtp.us-east-1.amazonses.com."
  type        = string
}

variable "spf_include" {
  description = "Domain the provider asks to be included in SPF, for example amazonses.com."
  type        = string
}

variable "dkim_records" {
  description = "DKIM records the provider hands out: selector to the public key."
  type        = map(string)
}

variable "dmarc_policy" {
  description = "p= of the DMARC record. Starts at none, moves to quarantine and then to reject."
  type        = string
  default     = "none"

  validation {
    condition     = contains(["none", "quarantine", "reject"], var.dmarc_policy)
    error_message = "A DMARC policy is none, quarantine or reject."
  }
}

variable "dmarc_reports_to" {
  description = "Address the aggregate reports go to."
  type        = string
}

variable "forwarded_addresses" {
  description = "Local part of each address Email Routing forwards."
  type        = list(string)
  default     = []
}

variable "forward_to" {
  description = "Mailbox every forwarded address lands in."
  type        = string
  sensitive   = true
  default     = null
}

variable "account_id" {
  description = "Cloudflare account the destination addresses belong to."
  type        = string
}
