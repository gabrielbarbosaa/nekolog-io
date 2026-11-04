variable "account_id" {
  description = "Cloudflare account that owns the buckets."
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

variable "export_lifetime_days" {
  description = "How long a generated export stays in the bucket before R2 deletes it."
  type        = number
  default     = 7

  validation {
    condition     = var.export_lifetime_days >= 1 && var.export_lifetime_days <= 30
    error_message = "An export lives between one and thirty days; the plan says seven."
  }
}

variable "location" {
  description = "Location hint, honoured only when the bucket is first created."
  type        = string
  default     = "wnam"

  validation {
    condition     = contains(["apac", "eeur", "enam", "weur", "wnam", "oc"], var.location)
    error_message = "The location has to be one of apac, eeur, enam, weur, wnam or oc."
  }
}
