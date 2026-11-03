variable "name" {
  description = "Project name on Vercel."
  type        = string
}

variable "repo" {
  description = "GitHub repository it deploys from, as owner/name."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.repo))
    error_message = "The repository has to be written as owner/name."
  }
}

variable "production_branch" {
  description = "Branch whose deployments are production."
  type        = string
  default     = "main"
}

variable "framework" {
  description = "Framework preset, or null to let Vercel detect it."
  type        = string
  default     = null
}

variable "root_directory" {
  description = "Directory inside the repository this project builds, or null for the repository root."
  type        = string
  default     = null
}

variable "build_command" {
  description = "Build command, or null for the framework default."
  type        = string
  default     = null
}

variable "install_command" {
  description = "Install command, or null for the framework default."
  type        = string
  default     = null
}

variable "ignore_command" {
  description = "Command that decides whether a commit is worth building."
  type        = string
  default     = null
}

variable "zone_name" {
  description = "Apex of the zone every domain of this project belongs to."
  type        = string
}

variable "domains" {
  description = "Hostname to the branch it serves. A null branch means production."
  type = map(object({
    git_branch = optional(string)
  }))
  default = {}
}

variable "variables" {
  description = "Which environment variables the project has and where each one reaches. Names and targets only — never a value."
  type = map(object({
    target     = list(string)
    git_branch = optional(string)
    sensitive  = optional(bool, true)
  }))
  default = {}
}

variable "values" {
  description = "The value of each variable declared above, by the same name."
  type        = map(string)
  default     = {}
  sensitive   = true
}
