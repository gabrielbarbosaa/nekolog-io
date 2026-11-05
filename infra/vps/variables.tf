variable "cloudflare_api_token" {
  description = "Token with DNS edit on the zone and R2 edit on the account."
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Account the bucket belongs to."
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

variable "vps_ipv4" {
  description = "Public address of the machine. It is bought by hand, so it arrives as a variable."
  type        = string
}

variable "hostnames" {
  description = "Every name the proxy on the machine answers on. Caddy has a site block for each."
  type = map(object({
    proxied = bool
  }))

  default = {
    "@"      = { proxied = true }
    "ingest" = { proxied = true }
    "api"    = { proxied = true }
  }
}

variable "backup_bucket" {
  description = "Bucket both backups write to, off the machine."
  type        = string
  default     = "nekolog-backups"
}

variable "backup_keep_days" {
  description = "How long a ClickHouse backup lives. Nothing in the code deletes one."
  type        = number
  default     = 30
}

variable "backup_location" {
  description = "Where the bucket is created."
  type        = string
  default     = "enam"
}
