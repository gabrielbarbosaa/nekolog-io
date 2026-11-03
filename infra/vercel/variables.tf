variable "vercel_api_token" {
  description = "Vercel token with access to the team that owns the projects."
  type        = string
  sensitive   = true
}

variable "vercel_team_id" {
  description = "Team the projects belong to, or null for a personal account."
  type        = string
  default     = null
}

variable "zone_name" {
  description = "Apex of the zone every domain belongs to."
  type        = string
  default     = "nekolog.io"
}

variable "site_repo" {
  description = "Repository the site and the documentation deploy from."
  type        = string
  default     = "gabrielbarbosaa/nekolog-io"
}

variable "dashboard_repo" {
  description = "Private repository the dashboard deploys from."
  type        = string
  default     = "gabrielbarbosaa/nekolog-dashboard"
}

variable "site_variables" {
  description = "Which environment variables the site project has, by name. Never a value."
  type = map(object({
    target     = list(string)
    git_branch = optional(string)
    sensitive  = optional(bool, true)
  }))
  default = {}
}

variable "site_values" {
  description = "Value of each variable of the site project."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "docs_variables" {
  description = "Which environment variables the documentation project has, by name. Never a value."
  type = map(object({
    target     = list(string)
    git_branch = optional(string)
    sensitive  = optional(bool, true)
  }))
  default = {}
}

variable "docs_values" {
  description = "Value of each variable of the documentation project."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "dashboard_variables" {
  description = "Which environment variables the dashboard project has, by name. Never a value."
  type = map(object({
    target     = list(string)
    git_branch = optional(string)
    sensitive  = optional(bool, true)
  }))
  default = {}
}

variable "dashboard_values" {
  description = "Value of each variable of the dashboard project."
  type        = map(string)
  default     = {}
  sensitive   = true
}
