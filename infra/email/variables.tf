variable "cloudflare_api_token" {
  description = "Token with DNS and Email Routing permission on the zone."
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Account the zone belongs to."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone of nekolog.io."
  type        = string
}

variable "zone_name" {
  description = "Apex of that zone."
  type        = string
  default     = "nekolog.io"
}

variable "mail_from_host" {
  description = "Host the provider gives for the bounce path."
  type        = string
}

variable "spf_include" {
  description = "Domain the provider asks to be included in SPF."
  type        = string
  default     = "amazonses.com"
}

variable "dkim_records" {
  description = "DKIM records the provider hands out, by selector. They only exist after the domain is added there."
  type        = map(string)
}

variable "dmarc_policy" {
  description = "p= of the DMARC record. Starts at none and tightens once the reports come back clean."
  type        = string
  default     = "none"
}

variable "forwarded_addresses" {
  description = "Local part of each received address. The plan shows these; they are not secret."
  type        = list(string)
  default     = ["security", "dmarc", "contato"]
}

variable "forward_to" {
  description = "Mailbox they are all forwarded to. Secret, because it is a personal address."
  type        = string
  sensitive   = true
  default     = null
}
