output "project_id" {
  description = "Id of the project on Vercel."
  value       = vercel_project.this.id
}

output "domains" {
  description = "Hostname to the branch that answers on it."
  value       = { for hostname, domain in vercel_project_domain.this : hostname => domain.git_branch }
}
