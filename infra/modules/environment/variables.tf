variable "account_id" {
  description = "Cloudflare account everything in this environment belongs to."
  type        = string
}

variable "zone_id" {
  description = "Zone of nekolog.io."
  type        = string
}

variable "zone_name" {
  description = "Apex of that zone, for example nekolog.io."
  type        = string
}

variable "environment" {
  description = "dev, qa or prod."
  type        = string

  validation {
    condition     = contains(["dev", "qa", "prod"], var.environment)
    error_message = "The environment has to be dev, qa or prod."
  }
}

variable "operator_emails" {
  description = "Addresses allowed through Access from a browser."
  type        = list(string)
}

variable "operator_session_duration" {
  description = "How long an operator session lasts before Access asks again."
  type        = string
  default     = "1h"
}

variable "r2_location" {
  description = "Location hint for the R2 buckets."
  type        = string
  default     = "wnam"
}
