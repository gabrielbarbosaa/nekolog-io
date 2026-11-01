output "ruleset_ids" {
  description = "Ruleset id per branch, as GitHub knows them."
  value       = { for name, ruleset in github_repository_ruleset.branch : name => ruleset.ruleset_id }
}
