variable "account_id" {
  description = "Cloudflare account that owns the bucket."
  type        = string
}

variable "name" {
  description = "Bucket name. It lives somewhere other than the machine on purpose."
  type        = string
  default     = "nekolog-backups"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,62}$", var.name))
    error_message = "An R2 bucket name is lowercase letters, digits and dashes."
  }
}

variable "clickhouse_prefix" {
  description = "Prefix the ClickHouse backup writes under. It is the only prefix this rule expires."
  type        = string
  default     = "clickhouse/"

  validation {
    condition     = endswith(var.clickhouse_prefix, "/") && length(var.clickhouse_prefix) > 1
    error_message = "The prefix has to name a folder, so it ends in a slash and is not just one."
  }
}

variable "keep_days" {
  description = "How long a ClickHouse backup stays before R2 deletes it. Nothing in the code deletes one."
  type        = number
  default     = 30

  validation {
    condition     = var.keep_days >= 7 && var.keep_days <= 365
    error_message = "Keep a backup between a week and a year."
  }
}

variable "location" {
  description = "Location hint, honoured only when the bucket is first created."
  type        = string
  default     = "enam"

  validation {
    condition     = contains(["apac", "eeur", "enam", "weur", "wnam", "oc"], var.location)
    error_message = "The location has to be one of apac, eeur, enam, weur, wnam or oc."
  }
}
