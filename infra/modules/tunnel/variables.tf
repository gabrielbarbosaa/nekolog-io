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

variable "environment" {
  description = "dev, qa or prod."
  type        = string

  validation {
    condition     = contains(["dev", "qa", "prod"], var.environment)
    error_message = "The environment has to be dev, qa or prod."
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
