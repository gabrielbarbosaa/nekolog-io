variable "tenancy_ocid" {
  description = "Tenancy the availability domains are listed from."
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment everything is created in."
  type        = string
}

variable "availability_domain_index" {
  description = "Which availability domain to use. Always Free capacity moves between them."
  type        = number
  default     = 0
}

variable "shape" {
  description = "Instance shape. The Always Free ARM shape is VM.Standard.A1.Flex."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "ocpus" {
  description = "Cores. The whole Always Free ARM allowance is 4; the plan uses half of it."
  type        = number
  default     = 2

  validation {
    condition     = var.ocpus >= 1 && var.ocpus <= 4
    error_message = "The Always Free ARM allowance is 4 OCPUs in total."
  }
}

variable "memory_in_gbs" {
  description = "Memory. The Always Free ARM allowance is 24 GB in total."
  type        = number
  default     = 12

  validation {
    condition     = var.memory_in_gbs >= 6 && var.memory_in_gbs <= 24
    error_message = "The Always Free ARM allowance is 24 GB in total."
  }
}

variable "boot_volume_size_in_gbs" {
  description = "Boot volume. Always Free gives 200 GB of block storage in total."
  type        = number
  default     = 100

  validation {
    condition     = var.boot_volume_size_in_gbs >= 50 && var.boot_volume_size_in_gbs <= 200
    error_message = "A boot volume has to be at least 50 GB, and Always Free gives 200 GB in total."
  }
}

variable "ubuntu_version" {
  description = "Ubuntu release. unattended-upgrades is why this is Ubuntu and not Oracle Linux."
  type        = string
  default     = "24.04"
}

variable "vcn_cidr" {
  description = "Address range of the VCN."
  type        = string
  default     = "10.20.0.0/16"
}

variable "subnet_cidr" {
  description = "Address range of the subnet the instance sits in."
  type        = string
  default     = "10.20.1.0/24"
}

variable "ssh_public_key" {
  description = <<-EOT
    Public key for the ubuntu user. There is no inbound rule for port 22, so it
    is only usable through Cloudflare Access; it is here so a rebuilt VM is
    reachable at all once the Access application for SSH exists.
  EOT

  type = string

  validation {
    condition     = can(regex("^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) ", trimspace(var.ssh_public_key)))
    error_message = "That does not look like an OpenSSH public key."
  }

  validation {
    condition     = !can(regex("PRIVATE KEY", var.ssh_public_key))
    error_message = "That is a private key. Pass the .pub file."
  }
}

variable "cloud_init" {
  description = "Rendered cloud-config for the instance."
  type        = string
  sensitive   = true
}
