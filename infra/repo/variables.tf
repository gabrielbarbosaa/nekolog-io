variable "github_token" {
  description = "Token with administration:write on the repository. Comes from the GitHub environment, never from a file."
  type        = string
  sensitive   = true
}

variable "owner" {
  description = "GitHub account that owns the repository."
  type        = string
  default     = "gabrielbarbosaa"
}

variable "repository" {
  description = "Repository the rulesets belong to."
  type        = string
  default     = "nekolog-io"
}

variable "adopt_ruleset_ids" {
  description = <<-EOT
    Ruleset ids that already exist and should be adopted instead of created,
    keyed by branch. They came from the rulesets created by hand in M0. Leave a
    branch out only when its ruleset genuinely does not exist yet, otherwise the
    apply fails with "name already in use".
  EOT

  type = map(string)

  default = {
    dev  = "26212283"
    qa   = "26212288"
    main = "26212292"
  }
}
