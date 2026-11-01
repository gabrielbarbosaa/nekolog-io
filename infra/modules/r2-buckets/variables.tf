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

variable "location" {
  description = "Location hint, honoured only when the bucket is first created."
  type        = string
  default     = "wnam"

  validation {
    condition     = contains(["apac", "eeur", "enam", "weur", "wnam", "oc"], var.location)
    error_message = "The location has to be one of apac, eeur, enam, weur, wnam or oc."
  }
}
