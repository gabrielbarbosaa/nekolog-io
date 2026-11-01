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
  description = "Addresses allowed to open an SSH session on the machine through Access."
  type        = list(string)
}

variable "tenancy_ocid" {
  description = "Oracle Cloud tenancy."
  type        = string
}

variable "user_ocid" {
  description = "Oracle Cloud user the API key belongs to."
  type        = string
}

variable "api_key_fingerprint" {
  description = "Fingerprint of that API key."
  type        = string
}

variable "api_private_key" {
  description = "The API private key itself. Comes from the GitHub environment, never from a file."
  type        = string
  sensitive   = true
}

variable "region" {
  description = "Oracle Cloud region, for example sa-saopaulo-1."
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment the VM is created in."
  type        = string
}

variable "ssh_public_key" {
  description = "Public key for the ubuntu user."
  type        = string
}

variable "state_bucket" {
  description = "Bucket the environment states live in, so the tunnels can be read from them."
  type        = string
}

variable "state_endpoint" {
  description = "S3 endpoint of that bucket."
  type        = string
}

variable "container_network" {
  description = "Subnet of the compose network, which is the only network ClickHouse accepts."
  type        = string
  default     = "172.28.0.0/16"

  validation {
    condition     = can(cidrhost(var.container_network, 0))
    error_message = "That is not a CIDR block."
  }

  validation {
    condition     = var.container_network != "0.0.0.0/0" && var.container_network != "::/0"
    error_message = "Opening ClickHouse to every address defeats the point of the tunnel."
  }
}
