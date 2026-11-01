variable "cloudflare_api_token" {
  description = "Token with the scopes listed in infra/README.md. Comes from the GitHub environment, never from a file."
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account id."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone id of nekolog.io."
  type        = string
}

variable "zone_name" {
  description = "Apex of that zone."
  type        = string
  default     = "nekolog.io"
}

variable "operator_emails" {
  description = "Addresses allowed through Access from a browser."
  type        = list(string)
}

variable "operator_session_duration" {
  description = "How long an operator session lasts before Access asks again."
  type        = string
  default     = "30m"
}

variable "r2_location" {
  description = "Location hint for the R2 buckets."
  type        = string
  default     = "wnam"
}