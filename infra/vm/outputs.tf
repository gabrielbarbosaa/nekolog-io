output "instance_id" {
  description = "OCID of the instance."
  value       = module.vm.instance_id
}

output "public_ip" {
  description = "Address the tunnel dials out from. Nothing listens on it."
  value       = module.vm.public_ip
}

output "clickhouse_passwords" {
  description = "One password per role and environment, for the Worker secrets and the CI migrator."
  value       = { for name, password in random_password.clickhouse : name => password.result }
  sensitive   = true
}
