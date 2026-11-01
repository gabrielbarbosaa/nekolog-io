variable "account_id" {
  description = "Cloudflare account that owns the application."
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

variable "hostname" {
  description = "Hostname Access protects, for example clickhouse-dev.nekolog.io."
  type        = string
}

variable "operator_emails" {
  description = "Addresses allowed to reach the hostname from a browser."
  type        = list(string)

  validation {
    condition     = length(var.operator_emails) > 0
    error_message = "Name at least one operator, otherwise only the service token can ever get in."
  }
}

variable "operator_session_duration" {
  description = "How long an operator session lasts before Access asks again."
  type        = string
  default     = "1h"
}

variable "token_duration" {
  description = "How long the service token stays valid before it has to be rotated."
  type        = string
  default     = "8760h"
}
