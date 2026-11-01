variable "account_id" {
  description = "Cloudflare account that owns the Worker."
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

variable "hostname" {
  description = "Full hostname the Worker answers on, for example ingest-dev.nekolog.io."
  type        = string
}

variable "service" {
  description = "Name of the Worker wrangler deployed, for example nekolog-ingest-dev."
  type        = string

  validation {
    condition     = can(regex("^nekolog-[a-z]+-(dev|qa|prod)$", var.service))
    error_message = "A domain may only point at a NekoLog Worker named after its environment."
  }
}
