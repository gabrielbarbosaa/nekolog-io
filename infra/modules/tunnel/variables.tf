variable "account_id" {
  description = "Cloudflare account that owns the tunnel."
  type        = string
}

variable "zone_id" {
  description = "Zone the hostname is created in."
  type        = string
}

variable "zone_name" {
  description = "Apex of that zone, for example nekolog.io."
  type        = string
}

variable "purpose" {
  description = "What this tunnel carries: an environment name, or ssh for the machine itself."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", var.purpose))
    error_message = "The purpose has to be lowercase letters, digits and dashes."
  }
}

variable "hostname" {
  description = "Label under the zone that points at the tunnel, without the apex."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", var.hostname))
    error_message = "The hostname label has to be lowercase letters, digits and dashes."
  }
}
