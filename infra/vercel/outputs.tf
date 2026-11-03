output "projects" {
  description = "Project id of each site, by name."
  value = {
    site      = module.site.project_id
    docs      = module.docs.project_id
    dashboard = module.dashboard.project_id
  }
}

output "domains" {
  description = "Every hostname declared here and the branch that answers on it."
  value = merge(
    module.site.domains,
    module.docs.domains,
    module.dashboard.domains,
  )
}
