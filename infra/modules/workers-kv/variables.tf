variable "account_id" {
  description = "Cloudflare account that owns the namespace."
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
