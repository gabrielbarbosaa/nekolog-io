terraform {
  required_version = ">= 1.13.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 9.11"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.api_key_fingerprint
  private_key      = var.api_private_key
  region           = var.region
  auth             = "ApiKey"
}

locals {
  environments = ["dev", "qa", "prod"]

  roles = setproduct(["reader", "ingest", "jobs"], local.environments)

  password_names = concat(
    [for pair in local.roles : "${pair[0]}_${pair[1]}"],
    ["migrator"],
  )

  tunnels = {
    for environment in local.environments : environment => {
      id          = data.terraform_remote_state.environment[environment].outputs.tunnel_id
      account_tag = data.terraform_remote_state.environment[environment].outputs.tunnel_account_tag
      secret      = data.terraform_remote_state.environment[environment].outputs.tunnel_secret
      hostname    = replace(data.terraform_remote_state.environment[environment].outputs.clickhouse_url, "https://", "")
    }
  }

  init_sql = {
    for file in fileset("${path.module}/../../deploy/vm/clickhouse/init", "*.sql") :
    file => file("${path.module}/../../deploy/vm/clickhouse/init/${file}")
  }

  clickhouse_users = templatefile("${path.module}/../../deploy/vm/clickhouse/users.xml.tftpl", {
    environments             = local.environments
    container_network        = var.container_network
    default_password_sha256  = sha256(random_password.clickhouse["default"].result)
    passwords                = { for name in local.password_names : name => sha256(random_password.clickhouse[name].result) }
  })

  cloud_init = templatefile("${path.module}/../../deploy/vm/cloud-init.yaml.tftpl", {
    compose           = file("${path.module}/../../deploy/vm/docker-compose.yml")
    clickhouse_users  = local.clickhouse_users
    init_sql          = local.init_sql
    tunnels           = local.tunnels
    migrator_password = random_password.clickhouse["migrator"].result
  })
}

data "terraform_remote_state" "environment" {
  for_each = toset(local.environments)

  backend = "s3"

  config = {
    bucket                      = var.state_bucket
    key                         = "${each.key}/terraform.tfstate"
    region                      = "auto"
    use_path_style              = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    endpoints                   = { s3 = var.state_endpoint }
  }
}

resource "random_password" "clickhouse" {
  for_each = toset(concat(local.password_names, ["default"]))

  length  = 40
  special = false
}

module "vm" {
  source = "../modules/oracle-vm"

  tenancy_ocid     = var.tenancy_ocid
  compartment_ocid = var.compartment_ocid
  ssh_public_key   = var.ssh_public_key
  cloud_init       = local.cloud_init
}
