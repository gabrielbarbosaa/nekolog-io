variable "account_id" {
  description = "Cloudflare account that owns the application."
  type        = string
}

variable "hostname" {
  description = "Hostname the SSH tunnel answers on, for example ssh.nekolog.io."
  type        = string
}

variable "operator_emails" {
  description = "Addresses allowed to open a session on the machine."
  type        = list(string)

  validation {
    condition     = length(var.operator_emails) > 0
    error_message = "Name at least one operator, otherwise nobody can ever reach the machine again."
  }
}

variable "session_duration" {
  description = "How long a session lasts before Access asks again."
  type        = string
  default     = "1h"
}
